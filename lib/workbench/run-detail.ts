import type { Run } from './types.ts';
/**
 * How many runs come back with their full step log.
 *
 * A chat keeps up to 30 runs and each one carries every prompt, tool result and
 * evaluation, so sending all of them made the response grow without bound — and
 * the client polls this endpoint while a run advances. The rest arrive without
 * traces and are fetched individually when someone opens them.
 */
export const DETAILED_RUNS = 6;
export function withoutTraces(run: Run): Run {
  return {
    ...run,
    tracesOmitted: true,
    attempts: run.attempts.map((a) => ({ ...a, traces: [] })),
  };
}
/**
 * `runs` is newest first. An active run always keeps its traces whatever its
 * position: the conversation renders its step log live as it advances.
 */
export function trimRunDetail(runs: Run[], limit = DETAILED_RUNS): Run[] {
  const keep = new Set(runs.slice(0, Math.max(0, limit)).map((r) => r.id));
  for (const r of runs)
    if (['running', 'paused', 'awaiting_approval'].includes(r.status))
      keep.add(r.id);
  return runs.map((r) => (keep.has(r.id) ? r : withoutTraces(r)));
}
