import type { Model, ModelResult, Usage } from './types.ts';
import { addUsage, emptyUsage } from './types.ts';
import { Validator } from '@cfworker/json-schema';

export type ModelEnvironment = Record<string, string | undefined>;
export function modelSettings(env: ModelEnvironment) {
  const provider = env.FOUNDRY_PROVIDER || (env.OPENROUTER_API_KEY ? 'openrouter' : 'gemini');
  if (provider !== 'openrouter' && provider !== 'gemini')
    throw new Error('FOUNDRY_PROVIDER must be openrouter or gemini');
  return {
    provider,
    key: (provider === 'openrouter' ? env.OPENROUTER_API_KEY : env.GEMINI_API_KEY) || '',
    model: env.FOUNDRY_MODEL || (provider === 'openrouter' ? 'openai/gpt-4o' : 'gemini-3.8-flash'),
    inputPrice: env.FOUNDRY_INPUT_PRICE_PER_MILLION,
    outputPrice: env.FOUNDRY_OUTPUT_PRICE_PER_MILLION,
    siteUrl: env.OPENROUTER_SITE_URL,
    appName: env.OPENROUTER_APP_NAME || 'Agent Foundry',
  };
}
export function workbenchModel(env: ModelEnvironment, fetcher: typeof fetch = fetch): Model {
  const settings = modelSettings(env);
  return settings.provider === 'openrouter'
    ? openRouterModel(settings, fetcher)
    : geminiModel(settings, fetcher);
}

export function openRouterModel(
  settings: GeminiSettings & { siteUrl?: string; appName?: string; maxOutputTokens?: number; maxAttempts?: number },
  fetcher: typeof fetch = fetch,
): Model {
  if (!settings.key) throw new Error('OpenRouter credentials are not configured');
  if (!/^[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._:/-]+$/.test(settings.model) || settings.model.length > 200)
    throw new Error('Invalid OpenRouter model identifier');
  return {
    async json<T>(system: string, input: unknown, schema: Record<string, unknown>): Promise<ModelResult<T>> {
      const started = performance.now(), prompt = JSON.stringify(input), usage = emptyUsage();
      const fail = (message: string) => new ModelCallError(message.replaceAll(settings.key, '[redacted]'), usage, performance.now() - started);
      if (prompt.length > 85000) throw fail('Context is too large for this step. Shorten the input or split the task.');
      const maxAttempts = settings.maxAttempts === 1 ? 1 : 2;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let response: Response;
        try {
          response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.key}`,
              'X-OpenRouter-Title': settings.appName || 'Agent Foundry',
              ...(settings.siteUrl ? { 'HTTP-Referer': settings.siteUrl } : {}),
            },
            signal: AbortSignal.timeout(55000),
            body: JSON.stringify({ model: settings.model, stream: false,
              max_tokens: settings.maxOutputTokens ?? (attempt ? 14000 : 7000),
              provider: { require_parameters: true },
              messages: [
                { role: 'system', content: system + (attempt ? ' Keep the structured response compact; the previous generation exceeded its token budget.' : '') },
                { role: 'user', content: prompt },
              ],
              response_format: { type: 'json_schema', json_schema: { name: 'foundry_response', strict: true, schema } },
            }),
          });
        } catch (error) {
          usage.costUsd = null;
          throw fail(`OpenRouter request failed: ${error instanceof Error ? error.message : 'transport error'}`);
        }
        const result = await response.json().catch(() => null) as {
          error?: { message?: string };
          choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        } | null;
        const u = result?.usage;
        if (typeof u?.prompt_tokens === 'number' && Number.isFinite(u.prompt_tokens) && u.prompt_tokens >= 0 &&
            typeof u.completion_tokens === 'number' && Number.isFinite(u.completion_tokens) && u.completion_tokens >= 0) {
          // OpenRouter reports billed cost, including routing/cache effects. Do not substitute Gemini prices.
          addUsage(usage, { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens,
            costUsd: typeof u.cost === 'number' && Number.isFinite(u.cost) && u.cost >= 0 ? u.cost : null,
            model: settings.model });
        } else usage.costUsd = null;
        if (!response.ok || result?.error)
          throw fail(`OpenRouter HTTP ${response.status}: ${(result?.error?.message || 'Request failed').replaceAll(settings.key, '[redacted]').slice(0, 500)}`);
        if (!u || !Number.isFinite(u.prompt_tokens) || !Number.isFinite(u.completion_tokens) ||
            u.prompt_tokens! < 0 || u.completion_tokens! < 0)
          throw fail('Model usage metadata missing; billing for this call is unknown');
        const choice = result?.choices?.[0];
        if (choice?.finish_reason === 'length' && attempt + 1 < maxAttempts) continue;
        if (choice?.finish_reason !== 'stop') throw fail(`Model output is incomplete (${choice?.finish_reason ?? 'no candidate'}).`);
        if (choice.message?.refusal) throw fail('Model declined this request.');
        const content = choice.message?.content;
        if (!content) throw fail('Model returned no structured output.');
        let value: T;
        try { value = JSON.parse(content) as T; } catch { throw fail('Model returned invalid JSON.'); }
        if (!new Validator(schema).validate(value).valid) throw fail('Model response did not match the required schema.');
        return { value, usage, durationMs: performance.now() - started };
      }
      throw fail('Model retry budget exhausted.');
    },
  };
}
export class ModelCallError extends Error {
  usage: Usage;
  durationMs: number;
  constructor(message: string, usage: Usage, durationMs: number) {
    super(message);
    this.usage = usage;
    this.durationMs = durationMs;
  }
}
export interface GeminiSettings {
  key: string;
  model: string;
  inputPrice?: string;
  outputPrice?: string;
}
export function geminiModel(
  settings: GeminiSettings,
  fetcher: typeof fetch = fetch,
): Model {
  if (!settings.key) throw new Error('Gemini credentials are not configured');
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(settings.model))
    throw new Error('Invalid model identifier');
  return {
    async json<T>(
      system: string,
      input: unknown,
      schema: Record<string, unknown>,
    ): Promise<ModelResult<T>> {
      const started = performance.now(),
        prompt = JSON.stringify(input),
        usage = emptyUsage();
      if (prompt.length > 85000)
        throw new Error(
          'Context is too large for this step. Shorten the input or split the task.',
        );
      // One bounded transport-level recovery for truncation. Both charged attempts remain in usage.
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetcher(
          `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': settings.key,
            },
            signal: AbortSignal.timeout(55000),
            body: JSON.stringify({
              systemInstruction: {
                parts: [
                  {
                    text:
                      system +
                      (attempt
                        ? ' Keep the structured response compact; the previous generation exceeded its token budget.'
                        : ''),
                  },
                ],
              },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                maxOutputTokens: attempt ? 14000 : 7000,
                responseMimeType: 'application/json',
                responseJsonSchema: schema,
                thinkingConfig: { thinkingLevel: 'low' },
              },
            }),
          },
        );
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new ModelCallError(
            `Gemini HTTP ${r.status}: ${(d.error?.message ?? 'Request failed').replaceAll(settings.key, '[redacted]').slice(0, 500)}`,
            usage,
            performance.now() - started,
          );
        }
        const result = (await r.json()) as {
          candidates?: {
            finishReason?: string;
            content?: { parts?: { text?: string; thought?: boolean }[] };
          }[];
          usageMetadata?: { promptTokenCount: number; totalTokenCount: number };
        };
        const c = result.candidates?.[0],
          u = result.usageMetadata;
        if (!u)
          throw new ModelCallError(
            'Model usage metadata missing; billing for this call is unknown',
            usage,
            performance.now() - started,
          );
        const inputTokens = u.promptTokenCount,
          outputTokens = u.totalTokenCount - u.promptTokenCount;
        // Published introductory text rates, verified 2026-09-05. Expire the fallback instead of guessing future prices.
        const introductory =
          settings.model === 'gemini-3.8-flash' &&
          new Date() < new Date('2027-01-01T00:00:00Z');
        const inputPrice =
            settings.inputPrice?.trim() || (introductory ? '0.75' : undefined),
          outputPrice =
            settings.outputPrice?.trim() || (introductory ? '3.75' : undefined);
        const ip = Number(inputPrice),
          op = Number(outputPrice),
          hasPrices =
            Boolean(inputPrice && outputPrice) &&
            Number.isFinite(ip) &&
            Number.isFinite(op) &&
            ip >= 0 &&
            op >= 0;
        addUsage(usage, {
          inputTokens,
          outputTokens,
          costUsd: hasPrices
            ? (inputTokens * ip + outputTokens * op) / 1e6
            : null,
          model: settings.model,
        });
        if (c?.finishReason === 'MAX_TOKENS' && attempt === 0) continue;
        if (c?.finishReason !== 'STOP')
          throw new ModelCallError(
            `Model output is incomplete (${c?.finishReason ?? 'no candidate'}).`,
            usage,
            performance.now() - started,
          );
        const text = c.content?.parts
          ?.filter((p) => !p.thought)
          .map((p) => p.text ?? '')
          .join('');
        if (!text)
          throw new ModelCallError(
            'Model returned no structured output.',
            usage,
            performance.now() - started,
          );
        let value: T;
        try {
          value = JSON.parse(text) as T;
        } catch {
          throw new ModelCallError(
            'Model returned invalid JSON.',
            usage,
            performance.now() - started,
          );
        }
        return { value, durationMs: performance.now() - started, usage };
      }
      throw new ModelCallError(
        'Model retry budget exhausted.',
        usage,
        performance.now() - started,
      );
    },
  };
}
