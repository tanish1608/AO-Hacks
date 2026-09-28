import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChat,
  startRun,
  advanceChatRun,
  executePending,
} from '../lib/workbench/engine.ts';
import {
  checkOutput,
  validationAttemptLimit,
  validateCases,
  planImprovement,
  recordImprovement,
  canApply,
} from '../lib/workbench/improvement.ts';
import { publication, instantiatePublished } from '../lib/workbench/sharing.ts';
import {
  emptyUsage,
  type Workflow,
  type Dependencies,
  type Evaluation,
  type Run,
  type Chat,
} from '../lib/workbench/types.ts';
import { digest } from '../lib/engine/runtime.ts';
const workflow: Workflow = {
  title: 'Invoice summary',
  explanation: 'Return a verified JSON summary.',
  nodes: [
    {
      id: 'writer',
      name: 'Writer',
      role: 'Compute',
      instruction: 'Return JSON with total.',
      toolkits: [],
      dependsOn: [],
    },
  ],
  criteria: [
    {
      id: 'facts',
      name: 'Facts',
      description: 'Grounded in input',
      weight: 1,
      required: true,
    },
    {
      id: 'format',
      name: 'Format',
      description: 'JSON',
      weight: 1,
      required: true,
    },
  ],
};
const cases = () =>
  validateCases([
    {
      id: 'tax',
      name: 'Tax after discount',
      input:
        'Two items at 100 each, discount 10 percent, tax 10 percent. Return JSON with total.',
      checks: [{ kind: 'json_number', path: 'total', value: '198.00' }],
    },
    {
      id: 'zero',
      name: 'Zero amount',
      input: 'Zero items. Return JSON with total.',
      checks: [{ kind: 'json_number', path: 'total', value: '0' }],
    },
  ]);
async function setup() {
  const c = createChat('test');
  c.versions = [
    {
      id: 'v',
      createdAt: 'now',
      workflow: structuredClone(workflow),
      digest: await digest(workflow),
      reason: 'seed',
    },
  ];
  c.regressionCases = cases();
  return c;
}
function passed(run: Run) {
  run.status = 'completed';
  run.attempts.at(-1)!.evaluation = {
    score: 1,
    verdict: 'pass',
    checks: [],
    summary: 'pass',
    issues: [],
    memoryVerdicts: [],
  };
}
async function suiteRun(chat: Chat) {
  const s = chat.improvement!;
  const run = await startRun(chat, false, undefined, {
    input: s.cases[s.index].input,
  });
  run.validationId = s.id;
  s.runId = run.id;
  run.attempts[0].workflow = structuredClone(s.candidate);
  passed(run);
  return run;
}
void test('numeric assertions parse JSON and compare decimal values without substring matches', () => {
  assert.equal(
    checkOutput('{"total":"198.000"}', {
      kind: 'json_number',
      path: 'total',
      value: '198',
    }),
    true,
  );
  assert.equal(
    checkOutput('{"total":1980}', {
      kind: 'json_number',
      path: 'total',
      value: '198',
    }),
    false,
  );
  assert.equal(
    checkOutput('{"total":-0.5}', {
      kind: 'json_number',
      path: 'total',
      value: '0.5',
    }),
    false,
  );
  assert.equal(
    checkOutput('{"total":"9007199254740993.01"}', {
      kind: 'json_number',
      path: 'total',
      value: '9007199254740993.010',
    }),
    true,
  );
  assert.equal(
    checkOutput('{"total":9007199254740993}', {
      kind: 'json_number',
      path: 'total',
      value: '9007199254740993',
    }),
    false,
  );
  assert.equal(
    checkOutput('Total: 198', {
      kind: 'json_number',
      path: 'total',
      value: '198',
    }),
    false,
  );
  assert.equal(
    checkOutput('{"total":null}', {
      kind: 'json_number',
      path: 'total',
      value: '0',
    }),
    false,
  );
});
void test('saved cases reject empty tests, duplicate IDs, unbounded values and executable paths', () => {
  for (const invalid of [
    [],
    [...cases(), cases()[0]],
    [{ ...cases()[0], input: '' }],
    [{ ...cases()[0], checks: [] }],
    [
      {
        ...cases()[0],
        checks: [{ kind: 'json_number', path: 'x[0]', value: '1' }],
      },
    ],
  ])
    assert.throws(() => validateCases(invalid));
});
void test('candidate rules and cases are frozen without changing live rules', async () => {
  const c = await setup();
  c.rules = ['Do not guess'];
  const s = await planImprovement(c, 'Use line discounts');
  c.rules.push('later');
  c.regressionCases![0].input = 'changed';
  assert.deepEqual(s.rules, ['Do not guess', 'Use line discounts']);
  assert.notEqual(s.cases[0].input, 'changed');
});
void test('a repair restarts all saved cases and cannot combine passes across different versions', async () => {
  const c = await setup();
  c.improvement = await planImprovement(c, 'Check totals');
  const s = c.improvement;
  await recordImprovement(s, await suiteRun(c));
  assert.equal(s.index, 1);
  const repaired = await suiteRun(c);
  repaired.attempts[0].workflow.nodes[0].instruction +=
    ' Include discount first.';
  await recordImprovement(s, repaired);
  assert.equal(s.index, 0);
  assert.equal(s.round, 2);
  assert.equal(s.status, 'running');
  await recordImprovement(s, await suiteRun(c));
  assert.equal(s.status, 'running');
  await recordImprovement(s, await suiteRun(c));
  assert.equal(s.status, 'passed');
  assert.equal(await canApply(c), true);
  c.rules = ['edited during review'];
  assert.equal(await canApply(c), false);
});
void test('changed saved tests invalidate candidate promotion', async () => {
  const c = await setup();
  c.improvement = await planImprovement(c, '');
  for (let i = 0; i < 2; i++)
    await recordImprovement(c.improvement, await suiteRun(c));
  assert.equal(await canApply(c), true);
  c.regressionCases![0].checks[0].value = '999';
  assert.equal(await canApply(c), false);
});
void test('failed cases, exhausted repair rounds and token budget never pass', async () => {
  for (const scenario of ['failed', 'rounds', 'budget']) {
    const c = await setup();
    c.improvement = await planImprovement(c, '');
    const s = c.improvement,
      r = await suiteRun(c);
    if (scenario === 'failed') r.status = 'blocked';
    if (scenario === 'rounds') {
      s.round = 3;
      r.attempts[0].workflow.nodes[0].instruction += ' changed';
    }
    if (scenario === 'budget') r.usage.inputTokens = 120000;
    await recordImprovement(s, r);
    assert.equal(s.status, 'failed');
    assert.equal(await canApply(c), false);
  }
});
void test('duplicate or unrelated case result cannot be counted', async () => {
  const c = await setup();
  c.improvement = await planImprovement(c, '');
  const r = await suiteRun(c);
  r.validationId = 'other';
  await assert.rejects(() => recordImprovement(c.improvement!, r));
});
void test('publishing and opening never copy the creator session, history, memory, tests, or learned facts', async () => {
  const c = await setup();
  c.sessionId = 'publisher-connection';
  c.messages = [
    {
      id: 'secret',
      role: 'user',
      content: 'PRIVATE CUSTOMER DOCUMENT',
      createdAt: 'now',
    },
  ];
  c.rules = ['Round each line'];
  const published = await publication(c, 'Upload your orders.');
  assert.equal(
    JSON.stringify(published).includes('PRIVATE CUSTOMER DOCUMENT'),
    false,
  );
  const a = await instantiatePublished('link', published),
    b = await instantiatePublished('link', published);
  assert.notEqual(a.id, b.id);
  assert.equal(a.sessionId, null);
  assert.deepEqual(a.messages, []);
  assert.deepEqual(a.memory, []);
  assert.equal(a.regressionCases, undefined);
  assert.equal(a.improvement, undefined);
  assert.equal(a.sourceShare, 'link');
  assert.equal(a.settings.maxIterations, 1);
  assert.deepEqual(a.rules, ['Round each line']);
  a.rules![0] = 'edited';
  assert.equal(b.rules![0], 'Round each line');
  c.versions[0].workflow.title = 'changed';
  assert.equal(published.title, 'Invoice summary');
});
void test('publishing requires a valid workflow and bounded public description', async () => {
  await assert.rejects(() => publication(createChat('empty'), 'Description'));
  await assert.rejects(async () => publication(await setup(), ''));
});
void test('regression tests block external writes even through the dispatch helper', async () => {
  const c = await setup(),
    r = await startRun(c);
  r.validationId = 'suite';
  r.pending = {
    id: 'p',
    nodeId: 'writer',
    tool: {
      slug: 'WRITE',
      toolkit: 'books',
      description: 'Write',
      schema: {},
      readOnly: false,
    },
    arguments: {},
    description: 'write',
    status: 'awaiting_approval',
  };
  let called = false;
  await assert.rejects(
    () =>
      executePending(c, r, {
        model: {
          json: async () => {
            throw Error('unused');
          },
        },
        tools: {
          search: async () => [],
          execute: async () => {
            called = true;
          },
        },
      }),
    /cannot write/,
  );
  assert.equal(called, false);
});
function fakeModel(output: string): Dependencies {
  return {
    tools: null,
    model: {
      async json<T>(system: string, input: unknown) {
        const data = input as {
          rubric: Workflow['criteria'];
          evidence: { id: string }[];
          workflow: Workflow;
        };
        let value: unknown;
        if (system.startsWith('You are an independent'))
          value = {
            score: 1,
            verdict: 'pass',
            summary: 'Model says perfect',
            issues: [],
            memoryVerdicts: [],
            checks: data.rubric.map((c) => ({
              criterionId: c.id,
              score: 1,
              rationale: 'Observed',
              evidenceIds: [data.evidence[0].id],
              verified: true,
            })),
          } satisfies Evaluation;
        else if (system.startsWith('Reflect'))
          value = {
            summary: 'Review',
            repairInstructions: 'Fix numeric output',
            memories: [],
          };
        else if (system.startsWith('Repair')) value = data.workflow;
        else
          value = {
            action: 'finish',
            output,
            toolSlug: '',
            argumentsJson: '{}',
            reason: '',
          };
        return { value: value as T, usage: emptyUsage(), durationMs: 1 };
      },
    },
  };
}
void test('deterministic failure overrides a perfect judge score and no-change repair stops', async () => {
  let c = await setup(),
    r = await startRun(c, false, undefined, { input: cases()[0].input });
  r.regressionCase = cases()[0];
  r.validationId = 'suite';
  const deps = fakeModel('{"total":200}');
  for (let i = 0; i < 10 && r.status === 'running'; i++) {
    const next = await advanceChatRun(c, r, deps);
    c = next.chat;
    r = next.run;
  }
  assert.equal(r.attempts[0].evaluation?.verdict, 'revise');
  assert.equal(r.status, 'exhausted');
  assert.match(r.error!, /no workflow changes/);
  assert.equal(c.versions.length, 1);
});
void test('validation and shared-session budgets stop before another paid model call', async () => {
  const c = await setup();
  c.improvement = await planImprovement(c, '');
  c.improvement.tokens = 120000;
  const r = await startRun(c);
  r.validationId = c.improvement.id;
  await assert.rejects(() => advanceChatRun(c, r, fakeModel('{}')), /budget/);
  delete r.validationId;
  c.sourceShare = 'link';
  r.usage.inputTokens = 40000;
  await assert.rejects(() => advanceChatRun(c, r, fakeModel('{}')), /budget/);
});

void test('exact JSON text assertions reject status substitutions and incidental mentions', () => {
  assert.equal(
    checkOutput('{"status":"draft"}', {
      kind: 'json_string',
      path: 'status',
      value: 'draft',
    }),
    true,
  );
  assert.equal(
    checkOutput('{"status":"active","note":"draft"}', {
      kind: 'json_string',
      path: 'status',
      value: 'draft',
    }),
    false,
  );
  assert.equal(
    checkOutput('{"status":null}', {
      kind: 'json_string',
      path: 'status',
      value: 'draft',
    }),
    false,
  );
  assert.throws(() =>
    validateCases([
      { ...cases()[0], checks: [{ kind: 'json_string', value: 'draft' }] },
    ]),
  );
});
void test('the same completed run cannot advance the saved case queue twice', async () => {
  const c = await setup();
  c.improvement = await planImprovement(c, '');
  const r = await suiteRun(c);
  await recordImprovement(c.improvement, r);
  await assert.rejects(() => recordImprovement(c.improvement!, r));
  assert.equal(c.improvement.results.length, 1);
});

void test('held-out cases run last and receive no repair attempts', () => {
  const saved = validateCases([{ ...cases()[0], heldOut: true }, cases()[1]]);
  assert.equal(saved[1].heldOut, true);
  assert.equal(validationAttemptLimit(saved[1]), 1);
  assert.equal(validationAttemptLimit(saved[0]), 2);
});
