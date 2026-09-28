/**
 * Models a workflow may be run on.
 *
 * This is an allowlist, not a free-text field. Every step of the loop asks for
 * a strict JSON schema response, so a model without structured-output support
 * fails every call rather than degrading — the list below was checked against
 * OpenRouter's `supported_parameters` before being added. Prices are USD per
 * million tokens as published at the time of writing and are shown to set
 * expectations, not to bill: recorded cost always comes from what the provider
 * actually reported for the call.
 */
export interface ModelChoice {
  id: string;
  name: string;
  maker: string;
  note: string;
  inputPrice: number;
  outputPrice: number;
  contextTokens: number;
}
export const DEFAULT_MODEL = 'openai/gpt-6-sol';
export const MODELS: ModelChoice[] = [
  {
    id: 'openai/gpt-6-sol',
    name: 'GPT-6 Sol',
    maker: 'OpenAI',
    note: 'Balanced default. Handles multi-step design and evaluation well.',
    inputPrice: 2,
    outputPrice: 10,
    contextTokens: 1_050_000,
  },
  {
    id: 'openai/gpt-6-luna',
    name: 'GPT-6 Luna',
    maker: 'OpenAI',
    note: 'Twenty times cheaper. Good for drafting and repeat runs.',
    inputPrice: 0.1,
    outputPrice: 0.5,
    contextTokens: 1_050_000,
  },
  {
    id: 'openai/gpt-6-astra',
    name: 'GPT-6 Astra',
    maker: 'OpenAI',
    note: 'Most capable, and priced like it. For workflows that keep failing.',
    inputPrice: 10,
    outputPrice: 50,
    contextTokens: 1_050_000,
  },
  {
    id: 'anthropic/claude-opus-5.5',
    name: 'Claude Opus 5.5',
    maker: 'Anthropic',
    note: 'Strong at long instructions and careful evaluation.',
    inputPrice: 4,
    outputPrice: 20,
    contextTokens: 1_000_000,
  },
  {
    id: 'google/gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    maker: 'Google',
    note: 'Fast and inexpensive. The model behind this project’s early evidence.',
    inputPrice: 0.75,
    outputPrice: 3.75,
    contextTokens: 1_048_576,
  },
  {
    id: 'x-ai/grok-4.7',
    name: 'Grok 4.7',
    maker: 'xAI',
    note: 'Quick, mid-priced alternative.',
    inputPrice: 1.6,
    outputPrice: 4.8,
    contextTokens: 500_000,
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    maker: 'DeepSeek',
    note: 'Low cost with a large context window.',
    inputPrice: 0.3,
    outputPrice: 1.2,
    contextTokens: 1_048_576,
  },
  {
    id: 'qwen/qwen3.8-max-prime',
    name: 'Qwen3.8 Max Prime',
    maker: 'Alibaba',
    note: 'Capable general model, competitive on long inputs.',
    inputPrice: 4,
    outputPrice: 12,
    contextTokens: 1_000_000,
  },
];
export function modelChoice(id: string | undefined): ModelChoice | undefined {
  return MODELS.find((m) => m.id === id);
}
/**
 * The model a run should use. An unknown id falls back to the deployment
 * default rather than failing: a saved workflow must keep working after a model
 * is retired from the list.
 */
export function resolveModel(
  requested: string | undefined,
  fallback: string,
): string {
  return requested && modelChoice(requested) ? requested : fallback;
}
/** Rejects anything not on the list, so a request body cannot pick a model
 *  whose responses the engine could not parse. */
export function validateModel(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !modelChoice(value))
    throw new Error('Choose one of the available models.');
  return value;
}
