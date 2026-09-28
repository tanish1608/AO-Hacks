import type { Chat, Run, Workflow } from './types.ts';
import { digest } from './digest.ts';
import { cleanRules } from './workspace.ts';

export type RegressionCheck = {
  kind: 'contains' | 'excludes' | 'json_number' | 'json_string';
  value: string;
  path?: string;
};
export interface RegressionCase {
  heldOut?: boolean;
  id: string;
  name: string;
  input: string;
  checks: RegressionCheck[];
}
export interface Improvement {
  id: string;
  status: 'running' | 'passed' | 'failed' | 'applied' | 'cancelled';
  baseDigest: string;
  baseRules: string[];
  rules: string[];
  candidate: Workflow;
  cases: RegressionCase[];
  index: number;
  round: number;
  maxRounds: number;
  results: {
    caseId: string;
    runId: string;
    round: number;
    passed: boolean;
    score: number;
    digest: string;
  }[];
  runId?: string;
  error: string | null;
  tokens: number;
  createdAt: string;
}
export function validateCases(input: unknown): RegressionCase[] {
  if (!Array.isArray(input) || !input.length || input.length > 5)
    throw Error('Save 1–5 test cases.');
  const ids = new Set<string>();
  return input
    .map((c: RegressionCase) => {
      if (
        !c ||
        (c.heldOut !== undefined && typeof c.heldOut !== 'boolean') ||
        typeof c.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) ||
        ids.has(c.id) ||
        typeof c.name !== 'string' ||
        !c.name.trim() ||
        c.name.length > 120 ||
        typeof c.input !== 'string' ||
        !c.input.trim() ||
        c.input.length > 12000 ||
        !Array.isArray(c.checks) ||
        !c.checks.length ||
        c.checks.length > 10
      )
        throw Error(
          'Each case needs a unique ID, name, input, and 1–10 checks.',
        );
      ids.add(c.id);
      const checks = c.checks.map((check) => {
        if (
          !check ||
          !['contains', 'excludes', 'json_number', 'json_string'].includes(
            check.kind,
          ) ||
          typeof check.value !== 'string' ||
          !check.value.trim() ||
          check.value.length > 1000
        )
          throw Error('Invalid test expectation.');
        if (
          check.kind.startsWith('json_') &&
          (typeof check.path !== 'string' ||
            !/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(check.path) ||
            check.path.length > 200 ||
            (check.kind === 'json_number' &&
              !/^-?\d+(?:\.\d+)?$/.test(check.value)))
        )
          throw Error(
            'Numeric checks require a JSON field path and decimal value.',
          );
        return {
          kind: check.kind,
          value: check.value.trim(),
          ...(check.kind.startsWith('json_') ? { path: check.path } : {}),
        };
      });
      return {
        id: c.id,
        name: c.name.trim(),
        input: c.input.trim(),
        checks,
        ...(c.heldOut ? { heldOut: true } : {}),
      };
    })
    .sort((a, b) => Number(Boolean(a.heldOut)) - Number(Boolean(b.heldOut)));
}
export function validationAttemptLimit(c: RegressionCase) {
  return c.heldOut ? 1 : 2;
}
function decimal(value: string) {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const result = `${BigInt(whole)}.${fraction.replace(/0+$/, '')}`;
  return (negative && result !== '0.' ? '-' : '') + result;
}
export function checkOutput(output: string, check: RegressionCheck): boolean {
  if (check.kind === 'contains')
    return output.toLowerCase().includes(check.value.toLowerCase());
  if (check.kind === 'excludes')
    return !output.toLowerCase().includes(check.value.toLowerCase());
  try {
    const text = output
      .trim()
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\s*```$/, '');
    let value: unknown = JSON.parse(text);
    for (const key of check.path!.split('.')) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
        return false;
      value = (value as Record<string, unknown>)[key];
    }
    if (check.kind === 'json_string')
      return typeof value === 'string' && value === check.value;
    // Require decimal strings for values outside JavaScript's safe integer range.
    if (
      typeof value === 'number' &&
      (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
    )
      return false;
    if (
      !['string', 'number'].includes(typeof value) ||
      !/^-?\d+(?:\.\d+)?$/.test(String(value))
    )
      return false;
    return decimal(String(value)) === decimal(check.value);
  } catch {
    return false;
  }
}
export async function planImprovement(
  chat: Chat,
  proposedRule: string,
): Promise<Improvement> {
  const workflow = chat.versions.at(-1)?.workflow;
  if (!workflow) throw Error('Create a workflow first.');
  const cases = validateCases(chat.regressionCases);
  const rules = cleanRules([
    ...(chat.rules ?? []),
    ...(proposedRule.trim() ? [proposedRule.trim()] : []),
  ]);
  return {
    id: crypto.randomUUID(),
    status: 'running',
    baseDigest: await digest(workflow),
    baseRules: structuredClone(chat.rules ?? []),
    rules,
    candidate: structuredClone(workflow),
    cases,
    index: 0,
    round: 1,
    maxRounds: 3,
    results: [],
    error: null,
    tokens: 0,
    createdAt: new Date().toISOString(),
  };
}
export async function recordImprovement(
  s: Improvement,
  run: Run,
): Promise<void> {
  if (s.status !== 'running' || s.runId !== run.id || run.validationId !== s.id)
    throw Error('Test run does not belong to this improvement.');
  s.runId = undefined;
  const last = run.attempts.at(-1)!;
  const passed =
    run.status === 'completed' && last.evaluation?.verdict === 'pass';
  const candidate = { ...last.workflow, criteria: s.candidate.criteria };
  const candidateDigest = await digest(candidate);
  s.results.push({
    caseId: s.cases[s.index].id,
    runId: run.id,
    round: s.round,
    passed,
    score: last.evaluation?.score ?? 0,
    digest: candidateDigest,
  });
  s.tokens += run.usage.inputTokens + run.usage.outputTokens;
  if (!passed || s.tokens >= 120000) {
    s.status = 'failed';
    s.error =
      run.error ??
      (s.tokens >= 120000
        ? 'Validation token budget reached.'
        : s.cases[s.index].heldOut
          ? 'The held-out case failed. The candidate was rejected without repairing against this case.'
          : 'A saved test failed. Review the evidence and adjust the candidate.');
    return;
  }
  if (candidateDigest !== (await digest(s.candidate))) {
    s.candidate = structuredClone(candidate);
    s.round++;
    s.index = 0;
    if (s.round > s.maxRounds) {
      s.status = 'failed';
      s.error =
        'Repair limit reached. Every case must pass the same workflow version.';
    }
  } else if (++s.index >= s.cases.length) s.status = 'passed';
}
export async function canApply(chat: Chat) {
  const s = chat.improvement;
  return Boolean(
    s?.status === 'passed' &&
    (await digest(chat.versions.at(-1)?.workflow)) === s.baseDigest &&
    JSON.stringify(chat.rules ?? []) === JSON.stringify(s.baseRules) &&
    JSON.stringify(chat.regressionCases) === JSON.stringify(s.cases),
  );
}
