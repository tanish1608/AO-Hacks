import { digest } from '../engine/runtime.ts';
import type { Chat, Experiment, ExperimentArm, Run, Knowledge } from './types.ts';
/** Hold tool knowledge constant in both arms to isolate the task-memory effect. */
export function frozenKnowledge(experiment?: Experiment): Knowledge {
  const records = structuredClone(experiment?.toolKnowledgeSnapshot ?? []);
  return {
    lookup: async (toolkits, slugs) => structuredClone(records.filter((r) =>
      toolkits.includes(r.toolkit) && (!slugs || !r.slug || slugs.includes(r.slug)))),
    record: async () => {},
  };
}
export const MAX_PAIRS = 3;
const PER_ARM_TOKENS = 120000;
const DEFAULT_MAX_COST_USD = 0.5;
/**
 * Arms alternate so a cancelled experiment still leaves balanced pairs. Memory
 * and tool knowledge are both frozen at plan time: an arm that learned from the
 * previous arm would confound the very comparison being measured.
 */
export async function planExperiment(
  chat: Chat,
  input: string,
  pairs: number,
  versionId: string,
  now: string,
): Promise<Experiment> {
  if (!Number.isInteger(pairs) || pairs < 1 || pairs > MAX_PAIRS)
    throw new Error(`Choose between 1 and ${MAX_PAIRS} pairs.`);
  const arms: ExperimentArm[] = [];
  for (let i = 0; i < pairs * 2; i++)
    arms.push({
      index: i,
      useMemory: i % 2 === 0,
      runId: null,
      status: 'pending',
    });
  const memorySnapshot = structuredClone(chat.memory);
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    status: 'running',
    versionId,
    input,
    memorySnapshot,
    memoryDigest: await digest(memorySnapshot),
    pairs,
    arms,
    budget: {
      maxRuns: pairs * 2,
      maxTokens: PER_ARM_TOKENS * pairs * 2,
      maxCostUsd: DEFAULT_MAX_COST_USD,
    },
    spent: { runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    error: null,
  };
}
export function nextArm(experiment: Experiment): ExperimentArm | null {
  if (experiment.status !== 'running') return null;
  return experiment.arms.find((a) => a.status === 'pending') ?? null;
}
/** Returns a stop reason, or null to continue. Checked before every arm starts. */
export function experimentBudgetExceeded(experiment: Experiment): string | null {
  const s = experiment.spent,
    b = experiment.budget;
  if (s.runs >= b.maxRuns) return null;
  if (s.inputTokens + s.outputTokens > b.maxTokens)
    return 'Experiment token budget reached.';
  // A null cost means pricing is unknown, not free: skip the cost guard, keep the token guard.
  if (b.maxCostUsd !== null && s.costUsd !== null && s.costUsd > b.maxCostUsd)
    return `Experiment cost budget of $${b.maxCostUsd.toFixed(2)} reached.`;
  return null;
}
/** Folds a finished arm's outcome back into the experiment and closes it when done. */
export function applyArmResult(
  experiment: Experiment,
  run: Run,
): Experiment {
  const next = structuredClone(experiment);
  const arm = next.arms.find((a) => a.runId === run.id);
  if (!arm || arm.status === 'done' || arm.status === 'failed') return next;
  arm.status = run.status === 'failed' ? 'failed' : 'done';
  next.spent.runs++;
  next.spent.inputTokens += run.usage.inputTokens;
  next.spent.outputTokens += run.usage.outputTokens;
  next.spent.costUsd =
    next.spent.costUsd === null || run.usage.costUsd === null
      ? null
      : next.spent.costUsd + run.usage.costUsd;
  // An arm that stops for an external write is not a measurement; end the experiment.
  if (run.status === 'awaiting_approval' || run.pending) {
    next.status = 'failed';
    next.error =
      'An arm requested an external write. Experiments run read-only workflows only.';
    return next;
  }
  const stop = experimentBudgetExceeded(next);
  if (stop) {
    next.status = 'failed';
    next.error = stop;
    return next;
  }
  if (!next.arms.some((a) => a.status === 'pending')) next.status = 'completed';
  return next;
}
export function startArm(
  experiment: Experiment,
  arm: ExperimentArm,
  runId: string,
): Experiment {
  const next = structuredClone(experiment);
  const target = next.arms.find((a) => a.index === arm.index)!;
  target.runId = runId;
  target.status = 'running';
  return next;
}
