import type { Model, ModelResult } from './types.ts';
import { addUsage, emptyUsage } from './types.ts';
import type { Usage } from '../engine/types.ts';
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
