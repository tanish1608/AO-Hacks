import type { Run, RunMetric } from './types.ts';
/** Medians, not means: arm sample sizes are tiny and outliers would dominate. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b),
    i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}
export function runMetrics(run: Run): RunMetric {
  const traces = run.attempts.flatMap((a) => a.traces);
  const last = run.attempts.at(-1);
  const tools = traces.filter((t) => t.kind === 'tool');
  const searches = traces.filter((t) => t.kind === 'search');
  return {
    runId: run.id,
    chatId: run.chatId,
    experimentId: run.experimentId ?? null,
    arm: run.arm ?? null,
    useMemory: run.useMemory,
    status: run.status,
    attempts: run.attempts.length,
    passed: run.mode !== 'manual' && run.status === 'completed' && Boolean(last?.evaluation),
    score: last?.evaluation?.score ?? null,
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    // Unknown pricing stays null. Never report an unpriced run as free.
    costUsd: run.usage.costUsd,
    durationMs: traces.reduce((n, t) => n + t.durationMs, 0),
    toolCalls: tools.length,
    // Wasted turns: failed calls plus tool requests the schema rejected.
    toolErrors:
      tools.filter((t) => t.error).length +
      traces.filter(
        (t) =>
          t.kind === 'model' &&
          t.error?.includes('failed the discovered JSON schema'),
      ).length,
    searchCalls: searches.length,
    searchCached: searches.filter(
      (t) => t.output.includes('"cached":true') || t.name.includes('reused'),
    ).length,
    graphDigest: last?.graphDigest ?? '',
    createdAt: run.createdAt,
  };
}
export interface TrendPoint {
  runId: string;
  at: string;
  score: number | null;
  attempts: number;
  passed: boolean;
  toolErrors: number;
  tokens: number;
  costUsd: number | null;
  useMemory: boolean;
}
export function learningTrend(metrics: RunMetric[], limit = 20): TrendPoint[] {
  return [...metrics]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-limit)
    .map((m) => ({
      runId: m.runId,
      at: m.createdAt,
      score: m.score,
      attempts: m.attempts,
      passed: m.passed,
      toolErrors: m.toolErrors,
      tokens: m.inputTokens + m.outputTokens,
      costUsd: m.costUsd,
      useMemory: m.useMemory,
    }));
}
export interface ArmStats {
  n: number;
  passRate: number;
  medianAttempts: number | null;
  medianTokens: number | null;
  medianCostUsd: number | null;
  medianDurationMs: number | null;
  medianToolErrors: number | null;
}
export type AblationVerdict =
  | 'insufficient_data'
  | 'memory_helped'
  | 'memory_hurt'
  | 'no_measurable_difference';
export interface AblationResult {
  verdict: AblationVerdict;
  memory: ArmStats;
  control: ArmStats;
  nPerArm: number;
  directionalOnly: boolean;
}
const MIN_PER_ARM = 3;
function stats(rows: RunMetric[]): ArmStats {
  const priced = rows
    .map((r) => r.costUsd)
    .filter((c): c is number => c !== null);
  return {
    n: rows.length,
    passRate: rows.length
      ? rows.filter((r) => r.passed).length / rows.length
      : 0,
    medianAttempts: median(rows.map((r) => r.attempts)),
    medianTokens: median(rows.map((r) => r.inputTokens + r.outputTokens)),
    // Null when any run was unpriced, rather than averaging a partial picture.
    medianCostUsd: priced.length === rows.length ? median(priced) : null,
    medianDurationMs: median(rows.map((r) => r.durationMs)),
    medianToolErrors: median(rows.map((r) => r.toolErrors)),
  };
}
/**
 * The verdict is computed here, not in the UI, so a null result cannot be
 * presented as a win. Below the sample floor the answer is always
 * 'insufficient_data' regardless of how the medians happen to fall.
 */
export function ablation(
  metrics: RunMetric[],
  experimentId: string,
): AblationResult {
  const rows = metrics.filter(
    (m) => m.experimentId === experimentId && ['completed', 'exhausted', 'blocked', 'failed'].includes(m.status),
  );
  const memory = rows.filter((r) => r.useMemory),
    control = rows.filter((r) => !r.useMemory);
  const nPerArm = Math.min(memory.length, control.length);
  const result: AblationResult = {
    verdict: 'insufficient_data',
    memory: stats(memory),
    control: stats(control),
    nPerArm,
    directionalOnly: true,
  };
  if (nPerArm < MIN_PER_ARM) return result;
  const a = result.memory,
    b = result.control;
  const better =
    a.passRate - b.passRate ||
    (b.medianAttempts ?? 0) - (a.medianAttempts ?? 0) ||
    (b.medianToolErrors ?? 0) - (a.medianToolErrors ?? 0);
  result.verdict =
    better > 0 ? 'memory_helped' : better < 0 ? 'memory_hurt' : 'no_measurable_difference';
  return result;
}
