import { retainMessages } from '../lib/workbench/messages.ts';
import { validateAppSelection } from '../lib/workbench/apps.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChat,
  design,
  startRun,
  advanceChatRun,
  executePending,
} from '../lib/workbench/engine.ts';
import {
  validateWorkflow,
  normalizeEvaluation,
  retrieveMemory,
} from '../lib/workbench/validation.ts';
import { ComposioGateway } from '../lib/workbench/composio.ts';
import type {
  Workflow,
  Evaluation,
  Model,
  Dependencies,
  Chat,
  Run,
  Memory,
  Criterion,
  Observation,
  ModelResult,
} from '../lib/workbench/types.ts';
import { emptyUsage } from '../lib/workbench/types.ts';
const workflow = (): Workflow => ({
  title: 'Editorial team',
  explanation: 'Write and review the requested brief.',
  nodes: [
    {
      id: 'writer',
      name: 'Writer',
      role: 'Writing',
      instruction: 'Produce the brief.',
      toolkits: [],
      dependsOn: [],
    },
    {
      id: 'editor',
      name: 'Editor',
      role: 'Review',
      instruction: 'Review and deliver the brief.',
      toolkits: [],
      dependsOn: ['writer'],
    },
  ],
  criteria: [
    {
      id: 'facts',
      name: 'Factual accuracy',
      description: 'Only supplied facts',
      weight: 2,
      required: true,
    },
    {
      id: 'format',
      name: 'Requested format',
      description: 'Three sections',
      weight: 1,
      required: true,
    },
  ],
});
async function setup() {
  const c = createChat(crypto.randomUUID());
  c.messages = [
    {
      id: 'message',
      role: 'user',
      content: 'Write an Atlas Notes product brief',
      createdAt: new Date().toISOString(),
    },
  ];
  c.versions = [
    {
      id: 'v1',
      createdAt: c.createdAt,
      workflow: workflow(),
      digest: 'test',
      reason: 'Initial',
    },
  ];
  return c;
}
const result = (value: unknown) => ({
  value,
  usage: { inputTokens: 10, outputTokens: 20, costUsd: null, model: 'test' },
  durationMs: 1,
});
function model({
  score = 1,
  tool = false,
  failOnce = false,
}: { score?: number; tool?: boolean; failOnce?: boolean } = {}): Model {
  let evaluations = 0;
  return {
    async json<T>(system: string, input: unknown) {
      const data = input as {
        rubric: Criterion[];
        evidence: Observation[];
        memory: Memory[];
        traceEvidence: Observation[];
        observations: Observation[];
      };
      if (system.startsWith('You are an independent')) {
        evaluations++;
        return result({
          checks: data.rubric.map((c: Criterion) => ({
            criterionId: c.id,
            score: failOnce && evaluations === 1 ? 0.1 : score,
            rationale: 'Checked source evidence',
            evidenceIds: [
              (
                data.evidence.find((t: Observation) => t.kind === 'model') ??
                data.evidence[0]
              ).id,
            ],
          })),
          summary: 'Evaluated',
          issues: [],
          memoryVerdicts: data.memory.map((m: Memory) => ({
            id: m.id,
            verdict: 'supported',
            evidenceIds: [data.evidence[0].id],
          })),
        }) as ModelResult<T>;
      }
      if (system.startsWith('Reflect'))
        return result({
          summary: 'Use the supplied brief.',
          repairInstructions: 'Improve grounding.',
          memories: [
            {
              kind: 'strategy',
              content:
                'For Atlas Notes briefs, ground every feature in the supplied brief.',
              evidence: [data.traceEvidence[0].id],
            },
          ],
        }) as ModelResult<T>;
      if (system.startsWith('Repair')) {
        const w = workflow();
        w.nodes[0].instruction = 'Use source evidence before writing';
        w.criteria[0].description = 'Ignore factual accuracy';
        return result(w) as ModelResult<T>;
      }
      if (
        tool &&
        !data.observations.some((t: Observation) => t.name === 'DOCS_READ')
      )
        return result({
          action: 'tool',
          toolSlug: 'DOCS_READ',
          argumentsJson: '{"id":"brief"}',
          reason: 'Read the supplied source',
          output: '',
        }) as ModelResult<T>;
      return result({
        action: 'finish',
        toolSlug: '',
        argumentsJson: '{}',
        reason: '',
        output:
          'Atlas Notes supports offline writing, Markdown export, and shared notebooks.',
      }) as ModelResult<T>;
    },
  };
}
async function finish(chat: Chat, run: Run, deps: Dependencies) {
  for (let i = 0; i < 60 && run.status === 'running'; i++)
    ({ chat, run } = await advanceChatRun(chat, run, deps));
  return { chat, run };
}
void test('workflow validation rejects dependency cycles and unjoined branches', () => {
  const w = workflow();
  w.nodes[0].dependsOn = ['editor'];
  assert.throws(() => validateWorkflow(w), /cycle/);
  const b = workflow();
  b.nodes[1].dependsOn = [];
  assert.throws(() => validateWorkflow(b), /final delivery/);
});
void test('rubric evidence and required criteria are enforced outside the judge', async () => {
  const c = await setup(),
    r = await startRun(c),
    a = r.attempts[0];
  a.states.forEach((s) => (s.status = 'done'));
  const raw = {
    checks: a.workflow.criteria.map((k) => ({
      criterionId: k.id,
      score: 1,
      rationale: 'Looks good',
      evidenceIds: ['invented'],
      verified: true,
    })),
    summary: 'Perfect',
    issues: [],
    memoryVerdicts: [],
  } as unknown as Evaluation;
  assert.equal(normalizeEvaluation(raw, r.rubric, a, 0.8).score, 0);
  assert.equal(normalizeEvaluation(raw, r.rubric, a, 0.8).verdict, 'revise');
});
void test('successful prose cannot prove external tool completion', async () => {
  const c = await setup(),
    r = await startRun(c),
    a = r.attempts[0];
  a.workflow.nodes[0].toolkits = ['googledocs'];
  a.states.forEach((s) => (s.status = 'done'));
  a.traces.push({
    id: 'claim',
    nodeId: 'writer',
    kind: 'model',
    name: 'Writer',
    at: c.createdAt,
    input: '',
    output: 'I read the source',
    error: null,
    usage: emptyUsage(),
    durationMs: 1,
    langsmith: 'disabled',
  });
  const raw = {
    checks: r.rubric.map((k) => ({
      criterionId: k.id,
      score: 1,
      rationale: 'Claimed success',
      evidenceIds: ['claim'],
    })),
    summary: 'Perfect',
    issues: [],
    memoryVerdicts: [],
  } as unknown as Evaluation;
  const judged = normalizeEvaluation(raw, r.rubric, a, 0.8);
  assert.equal(judged.score, 0);
  assert.match(judged.issues[0], /no successful tool evidence/);
});
void test('LangGraph executes, evaluates, and grows evidence-linked memory', async () => {
  const c = await setup();
  const result = await finish(c, await startRun(c), {
    model: model(),
    tools: null,
  });
  assert.equal(result.run.status, 'completed');
  assert.equal(result.chat.memory.length, 1);
  assert.equal(result.chat.memory[0].status, 'proposed');
  assert.ok(result.run.usage.inputTokens > 0);
  assert.equal(c.memory.length, 0, 'input state is not mutated by graph steps');
});
void test('repairs preserve the frozen rubric and stop at the iteration limit', async () => {
  const c = await setup();
  c.settings.maxIterations = 2;
  const result = await finish(c, await startRun(c), {
    model: model({ score: 0.2 }),
    tools: null,
  });
  assert.equal(result.run.status, 'exhausted');
  assert.equal(result.run.attempts.length, 2);
  assert.deepEqual(
    result.run.attempts[1].workflow.criteria,
    workflow().criteria,
  );
});
void test('a failed attempt can improve through targeted architecture repair', async () => {
  const c = await setup();
  const result = await finish(c, await startRun(c), {
    model: model({ failOnce: true }),
    tools: null,
  });
  assert.equal(result.run.status, 'completed');
  assert.deepEqual(
    result.run.attempts.map((a) => a.evaluation?.score),
    [0.10000000000000002, 1],
  );
  assert.equal(
    result.run.attempts[1].workflow.nodes[0].instruction,
    'Use source evidence before writing',
  );
});
void test('memory is isolated by chat and supported only with later-run evidence', async () => {
  let c = await setup();
  let outcome = await finish(c, await startRun(c), {
    model: model(),
    tools: null,
  });
  c = outcome.chat;
  const other = await setup();
  assert.equal(retrieveMemory(other, 'Atlas Notes').length, 0);
  assert.equal(c.memory[0].supportedRuns.length, 0);
  outcome = await finish(c, await startRun(c), { model: model(), tools: null });
  assert.equal(outcome.chat.memory[0].status, 'supported');
  assert.equal(outcome.chat.memory[0].supportedRuns.length, 1);
  assert.equal(outcome.chat.memory[0].usedCount, 1);
});
void test('unknown mutation semantics stage a review and uncertain outcomes never retry', async () => {
  const c = await setup();
  c.versions[0].workflow.nodes[0].toolkits = ['googledocs'];
  let calls = 0;
  const deps: Dependencies = {
    model: model({ tool: true }),
    tools: {
      search: async () => [
        {
          slug: 'DOCS_READ',
          toolkit: 'googledocs',
          description: 'Read',
          schema: { type: 'object' },
          readOnly: false,
        },
      ],
      execute: async () => {
        calls++;
        throw new Error('Connection lost after dispatch');
      },
    },
  };
  const r = await startRun(c);
  let s = await advanceChatRun(c, r, deps);
  s = await advanceChatRun(s.chat, s.run, deps);
  assert.equal(s.run.status, 'awaiting_approval');
  assert.equal(calls, 0);
  await executePending(s.chat, s.run, deps);
  assert.equal(s.run.status, 'blocked');
  assert.equal(s.run.pending?.status, 'unknown');
  await assert.rejects(() => executePending(s.chat, s.run, deps), /Reconcile/);
  assert.equal(calls, 1);
});
void test('Composio discovery normalizes toolkit case and excludes meta tools', async () => {
  const fetcher = (async () =>
    Response.json({
      tool_schemas: {
        a: {
          toolkit: 'GOOGLEDOCS',
          tool_slug: 'DOCS_READ',
          description: 'Read',
          input_schema: { type: 'object' },
          hasFullSchema: true,
        },
        b: {
          toolkit: 'GOOGLEDOCS',
          tool_slug: 'COMPOSIO_MULTI_EXECUTE_TOOL',
          description: 'Escape',
          input_schema: {},
          hasFullSchema: true,
        },
        c: {
          toolkit: 'SLACK',
          tool_slug: 'SLACK_SEND',
          description: 'Other app',
          input_schema: {},
          hasFullSchema: true,
        },
      },
    })) as typeof fetch;
  const tools = await new ComposioGateway('test', fetcher).search(
    'session',
    'Read a document',
    ['googledocs'],
  );
  assert.deepEqual(
    tools.map((t) => t.slug),
    ['DOCS_READ'],
  );
  assert.equal(tools[0].toolkit, 'googledocs');
  assert.equal(tools[0].readOnly, false);
});
void test('deterministic word counts override a generous model judge', async () => {
  const c = await setup(),
    r = await startRun(c),
    a = r.attempts[0];
  r.rubric[1].assertion = { kind: 'word_count', min: 10, max: 20, terms: [] };
  a.states.forEach((s) => (s.status = 'done'));
  a.states[1].output = 'Only three words';
  a.traces.push({
    id: 'final',
    nodeId: 'editor',
    kind: 'model',
    name: 'Editor',
    at: c.createdAt,
    input: '',
    output: 'Only three words',
    error: null,
    usage: emptyUsage(),
    durationMs: 1,
    langsmith: 'disabled',
  });
  const raw = {
    checks: r.rubric.map((k) => ({
      criterionId: k.id,
      score: 1,
      rationale: 'Pass',
      evidenceIds: ['final'],
    })),
    summary: 'Pass',
    issues: [],
    memoryVerdicts: [],
  } as unknown as Evaluation;
  const e = normalizeEvaluation(raw, r.rubric, a, 0.8);
  assert.equal(e.checks[1].score, 0);
  assert.match(e.checks[1].rationale, /3 whitespace-separated words/);
  assert.equal(e.verdict, 'revise');
});
void test('disconnected capabilities stop before an app call', async () => {
  const c = await setup();
  c.versions[0].workflow.nodes[0].toolkits = ['googledocs'];
  let calls = 0;
  const deps: Dependencies = {
    model: model(),
    tools: {
      search: async () => [
        {
          slug: 'DOCS_READ',
          toolkit: 'googledocs',
          description: 'Read',
          schema: { type: 'object' },
          readOnly: false,
          connected: false,
        },
      ],
      execute: async () => {
        calls++;
      },
    },
  };
  const result = await finish(c, await startRun(c), deps);
  assert.equal(result.run.status, 'blocked');
  assert.equal(calls, 0);
  assert.equal(result.run.attempts[0].states[0].blockReason, 'connection');
});
void test('Gemini truncation recovery preserves all reported usage and stays bounded', async () => {
  const { geminiModel } = await import('../lib/workbench/model.ts');
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json({
      candidates: [
        {
          finishReason: calls === 1 ? 'MAX_TOKENS' : 'STOP',
          content: { parts: [{ text: '{"answer":"ok"}' }] },
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        totalTokenCount: calls === 1 ? 7100 : 200,
      },
    });
  }) as typeof fetch;
  const response = await geminiModel(
    { key: 'test', model: 'test', inputPrice: '1', outputPrice: '2' },
    fetcher,
  ).json<{ answer: string }>('test', {}, {});
  assert.equal(calls, 2);
  assert.equal(response.value.answer, 'ok');
  assert.equal(response.usage.inputTokens, 200);
  assert.equal(response.usage.outputTokens, 7100);
  assert.equal(response.usage.costUsd, 0.0144);
});
void test('invalid tool arguments are fed back without dispatch', async () => {
  const c = await setup();
  c.versions[0].workflow.nodes[0].toolkits = ['googledocs'];
  let calls = 0;
  const deps: Dependencies = {
    model: model({ tool: true }),
    tools: {
      search: async () => [
        {
          slug: 'DOCS_READ',
          toolkit: 'googledocs',
          description: 'Read',
          schema: {
            type: 'object',
            required: ['document_id'],
            properties: { document_id: { type: 'string' } },
          },
          readOnly: true,
        },
      ],
      execute: async () => {
        calls++;
      },
    },
  };
  let s = await advanceChatRun(c, await startRun(c), deps);
  s = await advanceChatRun(s.chat, s.run, deps);
  assert.equal(calls, 0);
  assert.equal(s.run.status, 'running');
  assert.match(
    s.run.attempts[0].traces.at(-1)!.error!,
    /failed the discovered JSON schema/,
  );
});

void test('chat records outputs, failed checks, repair, and successful retest in order', async () => {
  const chat = await setup();
  const result = await finish(chat, await startRun(chat), {
    model: model({ failOnce: true }),
    tools: null,
  });
  const events = result.chat.messages.filter((m) => m.kind);
  assert.deepEqual(
    events.map((m) => m.kind),
    [
      'agent_result',
      'agent_result',
      'evaluation',
      'reflection',
      'repair',
      'agent_result',
      'agent_result',
      'evaluation',
      'reflection',
      'run_finished',
    ],
  );
  assert.equal(new Set(events.map((m) => m.id)).size, events.length);
  for (const event of events) {
    assert.equal(event.runId, result.run.id);
    assert.ok(result.run.attempts.some((a) => a.id === event.attemptId));
    assert.ok(event.content.trim());
  }
  assert.equal(
    events.filter((m) => m.kind === 'evaluation')[0].attemptId,
    result.run.attempts[0].id,
  );
  assert.equal(
    events.filter((m) => m.kind === 'evaluation')[1].attemptId,
    result.run.attempts[1].id,
  );
  const before = structuredClone(result.chat.messages);
  await assert.rejects(
    () =>
      advanceChatRun(result.chat, result.run, { model: model(), tools: null }),
    /Run is not active/,
  );
  assert.deepEqual(result.chat.messages, before);
});

void test('app selection accepts known apps and rejects unsupported or oversized scopes', () => {
  assert.deepEqual(validateAppSelection(['googledocs', 'github', 'github']), [
    'googledocs',
    'github',
  ]);
  assert.equal(validateAppSelection(undefined), undefined);
  assert.throws(
    () => validateAppSelection(['unknown-toolkit']),
    /supported apps/,
  );
  assert.throws(() => validateAppSelection(Array(9).fill('github')), /eight/);
  assert.throws(() => validateAppSelection('github'), /supported apps/);
});

void test('long chat test loops retain the original task and latest user instructions', () => {
  const messages = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    role: (i === 0 || i === 8 || i === 25 ? 'user' : 'assistant') as
      | 'user'
      | 'assistant',
    content: 'message ' + i,
    createdAt: '',
  }));
  const kept = retainMessages(messages);
  assert.ok(kept.length <= 80);
  assert.deepEqual(
    kept.filter((m) => m.role === 'user').map((m) => m.id),
    ['0', '8', '25'],
  );
  assert.equal(kept.at(-1)?.id, '99');
  assert.equal(messages.length, 100);
});

void test('generated tests preserve their fixture across bounded repairs',async()=>{
 const c=await setup();const delegate=model({failOnce:true});let fixtures=0;const inputs:string[]=[];
 const m:Model={async json<T>(system:string,input:unknown,schema:Record<string,unknown>){if(system.startsWith('Create one concrete')){fixtures++;return result({input:'Synthetic Atlas Notes brief',explanation:'Generated test fixture'}) as ModelResult<T>;}if(system.startsWith('You are Writer')||system.startsWith('You are Editor'))inputs.push((input as {runInput:string}).runInput);return delegate.json<T>(system,input,schema);}};
 const outcome=await finish(c,await startRun(c,true,undefined,{mode:'test',generateInput:true}),{model:m,tools:null});
 assert.equal(fixtures,1);assert.equal(outcome.run.status,'completed');assert.equal(outcome.run.attempts.length,2);assert.ok(inputs.length>=4);assert.ok(inputs.every(s=>s==='Synthetic Atlas Notes brief'));assert.equal(outcome.chat.messages.filter(m=>m.kind==='test_input').length,1);
});
void test('manual input executes once without test evaluation, repairs, or chat pollution',async()=>{
 const c=await setup();const before=structuredClone(c.messages);let calls=0;
 const m:Model={async json<T>(system:string,input:unknown){assert.ok(!system.startsWith('Reflect')&&!system.startsWith('Repair')&&!system.startsWith('You are an independent'));calls++;return result({action:'finish',output:(input as {runInput:string}).runInput,toolSlug:'',argumentsJson:'{}',reason:''}) as ModelResult<T>;}};
 const outcome=await finish(c,await startRun(c,true,undefined,{mode:'manual',input:'A completely different user document'}),{model:m,tools:null});
 assert.equal(calls,2);assert.equal(outcome.run.status,'completed');assert.equal(outcome.run.maxIterations,1);assert.equal(outcome.run.attempts[0].evaluation,null);assert.equal(outcome.run.attempts[0].states.at(-1)?.output,'A completely different user document');assert.deepEqual(outcome.chat.messages,before);assert.deepEqual(outcome.chat.memory,c.memory);assert.equal(outcome.chat.versions.length,c.versions.length);
 await assert.rejects(()=>startRun(c,true,undefined,{mode:'manual',input:' '}),/Provide input/);
});
void test('follow-up architecture edits preserve the chat identity, title, and history',async()=>{
 const c=await setup();c.title='My original task';
 const m:Model={async json<T>(){return result({...workflow(),title:'A different proposed title'}) as ModelResult<T>;}};
 const updated=await design(c,'Make the tone more direct', {model:m,tools:null},[]);
 assert.equal(updated.id,c.id);assert.equal(updated.title,c.title);assert.equal(updated.versions.length,2);assert.deepEqual(updated.messages[0],c.messages[0]);assert.ok(updated.messages.some(m=>m.content==='Make the tone more direct'));
});
