import { CONTRACTS } from '../lib/engine/contracts.ts';
import { newExperiment, advanceExperiment } from '../lib/engine/optimizer.ts';
const results = [];
for (const contract of CONTRACTS) {
  let run = newExperiment(crypto.randomUUID(), {
    name: contract.name,
    contract,
    mode: 'reference',
    iterations: 6,
    repeats: 3,
    qualityFloor: 1,
    maxToolCalls: 8,
    tokenBudget: 50000,
  });
  while (!['completed', 'failed'].includes(run.status))
    run = await advanceExperiment(run);
  results.push({
    domain: contract.domain,
    status: run.status,
    baseline: run.sealed?.baseline,
    selected: run.sealed?.selected,
  });
}
console.log(
  JSON.stringify(
    {
      kind: 'Synthetic deterministic reference search; not measured LLM generalization',
      results,
    },
    null,
    2,
  ),
);
