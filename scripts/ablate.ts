/**
 * Matched memory-on/off ablation over one fixed input and a frozen graph.
 * Tool-free, so it measures the memory effect without app authorization.
 * Reports whatever it finds, including no effect.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  advanceChatRun,
  createChat,
  design,
  startRun,
} from '../lib/workbench/engine.ts';
import { geminiModel } from '../lib/workbench/model.ts';
import { ablation, runMetrics } from '../lib/workbench/metrics.ts';
import { knowledgeKey, mergeKnowledge, newKnowledge } from '../lib/workbench/tool-knowledge.ts';
import type {
  Chat,
  Dependencies,
  Knowledge,
  RunMetric,
  ToolKnowledgeDraft,
  ToolKnowledgeRecord,
} from '../lib/workbench/types.ts';
const local = existsSync('.dev.vars')
  ? Object.fromEntries(
      readFileSync('.dev.vars', 'utf8')
        .split('\n')
        .filter((x) => x.includes('=') && !x.trimStart().startsWith('#'))
        .map((x) => {
          const i = x.indexOf('=');
          return [
            x.slice(0, i).trim(),
            x.slice(i + 1).trim().replace(/^["']|["']$/g, ''),
          ];
        }),
    )
  : {};
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const goal = args.find((a) => !a.startsWith('--'));
if (!goal) {
  console.error(
    'Usage: npm run ablate -- "task" --input="fixed input" --pairs=2',
  );
  process.exit(1);
}
const pairs = Math.max(1, Math.min(3, Number(flag('pairs', '2'))));
const input = flag('input', goal);
const rows = new Map<string, ToolKnowledgeRecord>();
const knowledge: Knowledge = {
  async lookup(toolkits) {
    return [...rows.values()].filter(
      (r) => r.status !== 'retired' && toolkits.includes(r.toolkit),
    );
  },
  async record(drafts: ToolKnowledgeDraft[]) {
    for (const d of drafts) {
      const id = await knowledgeKey('ablate', d);
      const at = new Date().toISOString();
      const existing = rows.get(id);
      rows.set(id, existing ? mergeKnowledge(existing, d, at) : newKnowledge(id, d, at));
    }
  },
};
const model = geminiModel({
  key: process.env.GEMINI_API_KEY || local.GEMINI_API_KEY,
  model: process.env.FOUNDRY_MODEL || local.FOUNDRY_MODEL || 'gemini-3.8-flash',
  inputPrice: process.env.FOUNDRY_INPUT_PRICE_PER_MILLION || local.FOUNDRY_INPUT_PRICE_PER_MILLION,
  outputPrice: process.env.FOUNDRY_OUTPUT_PRICE_PER_MILLION || local.FOUNDRY_OUTPUT_PRICE_PER_MILLION,
});
const deps: Dependencies = { model, tools: null, knowledge };
console.error('Designing the workflow…');
let chat: Chat = await design(createChat(crypto.randomUUID()), goal, deps, []);
const versionId = chat.versions.at(-1)!.id;
// A fresh chat has no memory, so arms would be identical and the comparison
// would measure nothing but model variance. Warm up first to give it something
// to ablate, then freeze.
console.error('Warm-up run to populate memory…');
let warm = await startRun(chat, true, versionId, { mode: 'test', input });
for (let i = 0; i < 40 && warm.status === 'running'; i++)
  ({ chat, run: warm } = await advanceChatRun(chat, warm, deps));
console.error(`  → ${warm.status}, ${chat.memory.length} memory entries`);
const memorySnapshot = structuredClone(chat.memory);
if (!memorySnapshot.length)
  console.error(
    'WARNING: memory is still empty. Both arms will be identical and the result measures variance, not memory.',
  );
const experimentId = crypto.randomUUID();
const metrics: RunMetric[] = [];
const arms = Array.from({ length: pairs * 2 }, (_, i) => i % 2 === 0);
for (const [index, useMemory] of arms.entries()) {
  console.error(
    `Arm ${index + 1}/${arms.length} · memory ${useMemory ? 'on' : 'off'}…`,
  );
  let run = await startRun(chat, useMemory, versionId, {
    mode: 'test',
    input,
    experimentId,
    arm: index,
    memoryPool: memorySnapshot,
  });
  run.maxIterations = Math.min(run.maxIterations, 2);
  for (let i = 0; i < 40 && run.status === 'running'; i++)
    ({ chat, run } = await advanceChatRun(chat, run, deps));
  metrics.push(runMetrics(run));
  console.error(`  → ${run.status}, ${run.attempts.length} attempt(s)`);
}
const result = ablation(metrics, experimentId);
console.log(
  JSON.stringify(
    {
      kind: 'Matched memory on/off ablation, tool-free, single task and input',
      caveat:
        'Directional only. One task, one input, small n. Not a significance test and not measured accuracy.',
      goal,
      pairs,
      model: process.env.FOUNDRY_MODEL || local.FOUNDRY_MODEL || 'gemini-3.8-flash',
      generatedAt: new Date().toISOString(),
      memoryEntriesUnderTest: memorySnapshot.length,
      // Repair legitimately changes the graph mid-run, so freezing is about the
      // graph every arm STARTED from, not the one it ended with.
      startingGraphFrozen: true,
      warmUpStatus: warm.status,
      verdict: result.verdict,
      nPerArm: result.nPerArm,
      arms: { memory: result.memory, control: result.control },
      runs: metrics,
      toolKnowledgeLearned: [...rows.values()].map((r) => ({
        claim: r.claim,
        status: r.status,
        observations: r.observations,
      })),
    },
    null,
    2,
  ),
);
