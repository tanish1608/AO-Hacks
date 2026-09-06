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
  promoteToolRules,
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
import {
  classifyToolError,
  extractToolKnowledge,
  knowledgeKey,
  mergeKnowledge,
  newKnowledge,
  formatKnowledgeForPrompt,
} from '../lib/workbench/tool-knowledge.ts';
import { sanitizeToolClaim, taskCorpus } from '../lib/workbench/redaction.ts';
import { ablation, runMetrics } from '../lib/workbench/metrics.ts';
import {
  applyArmResult,
  nextArm,
  planExperiment,
  startArm,
} from '../lib/workbench/experiment.ts';
import { applyLiveness, stripLiveness } from '../lib/workbench/tool-cache.ts';
import type {
  Attempt,
  DiscoveredTool,
  Knowledge,
  RunMetric,
  ToolKnowledgeDraft,
  ToolKnowledgeRecord,
} from '../lib/workbench/types.ts';
const SECRET_DOC = 'ATLASDOC0099771';
const SECRET_PROSE =
  'Atlas Notes retains confidential quarterly churn figures for enterprise accounts';
const docsTool = (): DiscoveredTool => ({
  slug: 'GOOGLEDOCS_GET_DOCUMENT_BY_ID',
  toolkit: 'googledocs',
  description: 'Read a document',
  schema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  readOnly: true,
});
function observation(over: Partial<Observation>): Observation {
  return {
    id: crypto.randomUUID(),
    nodeId: 'writer',
    kind: 'model',
    name: 'Writer',
    at: new Date().toISOString(),
    durationMs: 5,
    input: '',
    output: '',
    error: null,
    usage: emptyUsage(),
    langsmith: 'disabled',
    ...over,
  };
}
function attemptWith(traces: Observation[]): Attempt {
  return {
    id: 'attempt-1',
    iteration: 1,
    workflow: workflow(),
    graphDigest: 'graph',
    states: [
      {
        nodeId: 'writer',
        status: 'done',
        output: SECRET_PROSE,
        turns: 1,
        observations: traces.map((t) => t.id),
        tools: [docsTool()],
        error: null,
      },
      {
        nodeId: 'editor',
        status: 'done',
        output: '',
        turns: 1,
        observations: [],
        tools: [],
        error: null,
      },
    ],
    traces,
    evaluation: null,
    memoryIds: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}
void test('tool knowledge is derived from evidence and never carries task content', async () => {
  const rejected = observation({
    kind: 'model',
    output: JSON.stringify({
      action: 'tool',
      toolSlug: 'GOOGLEDOCS_GET_DOCUMENT_BY_ID',
      argumentsJson: JSON.stringify({
        document_id: SECRET_DOC,
        body: SECRET_PROSE,
      }),
    }),
    error:
      "Tool arguments failed the discovered JSON schema: required property 'id' is missing",
  });
  const succeeded = observation({
    kind: 'tool',
    name: 'GOOGLEDOCS_GET_DOCUMENT_BY_ID',
    input: JSON.stringify({ id: SECRET_DOC }),
    output: SECRET_PROSE,
  });
  const drafts = extractToolKnowledge(
    attemptWith([rejected, succeeded]),
    'run-a',
  );
  assert.equal(drafts.length, 2);
  const failure = drafts.find((d) => d.outcome === 'schema_rejected')!;
  assert.deepEqual(failure.argKeys, ['document_id', 'body']);
  assert.deepEqual(failure.rejectedKeys, ['document_id', 'body']);
  assert.deepEqual(failure.requiredKeys, ['id']);
  assert.equal(failure.errorSignature, 'schema:required:id');
  const records = drafts.map((d) => newKnowledge('id', d, 'now'));
  const serialized = JSON.stringify(records);
  assert.ok(!serialized.includes(SECRET_DOC), 'stored a resource identifier');
  assert.ok(!serialized.includes('confidential'), 'stored task prose');
  assert.ok(!serialized.includes('churn'), 'stored task prose');
  // Argument keys are the point of the record, so they must survive.
  assert.ok(serialized.includes('document_id'));
});
void test('a model-authored tool rule that echoes task content is dropped, not rewritten', async () => {
  const chat = await setup();
  const attempt = attemptWith([]);
  const corpus = taskCorpus(chat, await startRun(chat), attempt);
  const anchors = ['GOOGLEDOCS_GET_DOCUMENT_BY_ID', 'googledocs'];
  assert.equal(
    sanitizeToolClaim(
      `GOOGLEDOCS_GET_DOCUMENT_BY_ID returned ${SECRET_PROSE}`,
      corpus,
      anchors,
    ),
    null,
  );
  assert.equal(
    sanitizeToolClaim(
      'GOOGLEDOCS_GET_DOCUMENT_BY_ID needs a bare document id, not a share link.',
      corpus,
      anchors,
    ),
    'GOOGLEDOCS_GET_DOCUMENT_BY_ID needs a bare document id, not a share link.',
  );
  // A claim naming no discovered tool is not a tool rule.
  assert.equal(
    sanitizeToolClaim('Always write in a confident register.', corpus, anchors),
    null,
  );
  // Links, addresses and long identifiers never pass.
  for (const bad of [
    'GOOGLEDOCS_GET_DOCUMENT_BY_ID is documented at https://example.com/docs',
    'googledocs access is owned by someone@example.com',
    'googledocs document 998877665544 is the canonical fixture',
  ])
    assert.equal(sanitizeToolClaim(bad, corpus, anchors), null);
});
void test('tool knowledge stays proposed until a different run corroborates it', async () => {
  const draft = (runId: string): ToolKnowledgeDraft => ({
    toolkit: 'googledocs',
    slug: 'GOOGLEDOCS_GET_DOCUMENT_BY_ID',
    kind: 'argument_shape',
    argKeys: ['id'],
    rejectedKeys: [],
    requiredKeys: ['id'],
    errorSignature: null,
    outcome: 'ok',
    evidence: ['trace-1'],
    runId,
  });
  const first = newKnowledge('k1', draft('run-a'), 'now');
  assert.equal(first.status, 'proposed');
  // The same run repeating itself is not corroboration.
  assert.equal(mergeKnowledge(first, draft('run-a'), 'now').status, 'proposed');
  const confirmed = mergeKnowledge(first, draft('run-b'), 'later');
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.confirmedRun, 'run-b');
  assert.equal(confirmed.observations, 2);
  // Only confirmed rules are injected into prompts.
  assert.equal(formatKnowledgeForPrompt([first]).length, 0);
  assert.equal(formatKnowledgeForPrompt([confirmed]).length, 1);
  // The same fact from two chats collapses onto one row.
  assert.equal(
    await knowledgeKey('owner', draft('run-a')),
    await knowledgeKey('owner', draft('run-z')),
  );
  assert.notEqual(
    await knowledgeKey('owner', draft('run-a')),
    await knowledgeKey('other-owner', draft('run-a')),
  );
});
void test('provider error text is reduced to a bounded signature', () => {
  assert.deepEqual(classifyToolError(null), { signature: null, outcome: 'ok' });
  assert.equal(
    classifyToolError(`404 not found: ${SECRET_DOC}`).signature,
    'http:404',
  );
  assert.equal(classifyToolError('HTTP 429 rate limit').outcome, 'rate_limited');
  assert.equal(
    classifyToolError('No active connection for this toolkit').outcome,
    'auth',
  );
  // Whatever the provider said, the stored token never contains it.
  for (const message of [
    `Composio failed reading ${SECRET_PROSE}`,
    `404 not found: ${SECRET_DOC}`,
  ])
    assert.ok(!classifyToolError(message).signature!.includes(SECRET_DOC));
});
void test('run metrics report null cost when pricing is unknown and count wasted turns', async () => {
  const chat = await setup();
  const result = await finish(chat, await startRun(chat), {
    model: model({ failOnce: true }),
    tools: null,
  });
  const m = runMetrics(result.run);
  assert.equal(m.costUsd, null, 'an unpriced run must never report zero cost');
  assert.equal(m.attempts, 2);
  assert.equal(m.passed, true);
  assert.equal(m.useMemory, true);
  assert.ok(m.inputTokens > 0);
});
void test('ablation reports insufficient data and never claims an unsupported win', () => {
  const metric = (
    useMemory: boolean,
    passed: boolean,
    attempts: number,
  ): RunMetric => ({
    runId: crypto.randomUUID(),
    chatId: 'chat',
    experimentId: 'exp',
    arm: 0,
    useMemory,
    status: passed ? 'completed' : 'exhausted',
    attempts,
    passed,
    score: passed ? 1 : 0.2,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: null,
    durationMs: 10,
    toolCalls: 0,
    toolErrors: 0,
    searchCalls: 0,
    searchCached: 0,
    graphDigest: 'g',
    createdAt: new Date().toISOString(),
  });
  // Two per arm, memory sweeping every case, is still not enough to claim a win.
  const thin = [
    metric(true, true, 1),
    metric(true, true, 1),
    metric(false, false, 3),
    metric(false, false, 3),
  ];
  assert.equal(ablation(thin, 'exp').verdict, 'insufficient_data');
  const helped = [...thin, metric(true, true, 1), metric(false, false, 3)];
  assert.equal(ablation(helped, 'exp').verdict, 'memory_helped');
  const hurt = helped.map((m) => ({ ...m, useMemory: !m.useMemory }));
  assert.equal(ablation(hurt, 'exp').verdict, 'memory_hurt');
  const same = [1, 2, 3].flatMap(() => [
    metric(true, true, 2),
    metric(false, true, 2),
  ]);
  assert.equal(ablation(same, 'exp').verdict, 'no_measurable_difference');
  // Cost stays null across the arm rather than summing to a misleading zero.
  assert.equal(ablation(same, 'exp').memory.medianCostUsd, null);
  assert.equal(ablation(same, 'other').verdict, 'insufficient_data');
});
void test('experiment arms alternate, freeze memory, and stop on an external write', async () => {
  const chat = await setup();
  chat.memory = [
    {
      id: 'm1',
      kind: 'strategy',
      content: 'Ground every claim in the supplied brief.',
      evidence: ['t1'],
      status: 'supported',
      createdAt: 'now',
      updatedAt: 'now',
      sourceRun: 'run-0',
      supportedRuns: [],
      usedCount: 0,
    },
  ];
  const experiment = await planExperiment(chat, 'Sample input', 2, 'v1', 'now');
  assert.deepEqual(
    experiment.arms.map((a) => a.useMemory),
    [true, false, true, false],
  );
  assert.equal(experiment.budget.maxRuns, 4);
  assert.equal(experiment.memorySnapshot.length, 1);
  // The snapshot is a copy: later chat memory changes cannot reach a running arm.
  chat.memory = [];
  assert.equal(experiment.memorySnapshot.length, 1);
  await assert.rejects(
    () => planExperiment(chat, 'Sample input', 9, 'v1', 'now'),
    /between 1 and 3 pairs/,
  );
  const run = await startRun(chat);
  const started = startArm(experiment, nextArm(experiment)!, run.id);
  assert.equal(started.arms[0].status, 'running');
  assert.equal(nextArm(started)!.index, 1);
  const stalled = applyArmResult(started, {
    ...run,
    id: run.id,
    status: 'awaiting_approval',
  });
  assert.equal(stalled.status, 'failed');
  assert.match(stalled.error!, /read-only/);
  assert.equal(nextArm(stalled), null);
});
void test('the schema cache never stores or serves a connection status', () => {
  const live: DiscoveredTool = { ...docsTool(), connected: true, source: 'live' };
  const stored = stripLiveness([live]);
  assert.ok(!('connected' in stored[0]), 'cached a connection status');
  assert.ok(!JSON.stringify(stored).includes('connected'));
  // A toolkit that has since been disconnected must come back false, not stale true.
  assert.equal(applyLiveness(stored, new Set())[0].connected, false);
  assert.equal(applyLiveness(stored, new Set(['googledocs']))[0].connected, true);
  assert.equal(applyLiveness(stored, new Set(['googledocs']))[0].source, 'cache');
});
/** In-memory stand-in for the owner-scoped store, with the same promotion rule. */
function knowledgeStore(seed: ToolKnowledgeRecord[] = []) {
  const rows = new Map(seed.map((r) => [r.id, r]));
  const written: ToolKnowledgeDraft[] = [];
  return {
    rows,
    written,
    store: {
      async lookup(toolkits: string[], slugs?: string[]) {
        return [...rows.values()].filter(
          (r) =>
            r.status !== 'retired' &&
            toolkits.includes(r.toolkit) &&
            (!slugs || !r.slug || slugs.includes(r.slug)),
        );
      },
      async record(drafts: ToolKnowledgeDraft[]) {
        written.push(...drafts);
        for (const d of drafts) {
          const id = await knowledgeKey('owner', d);
          const existing = rows.get(id);
          rows.set(
            id,
            existing
              ? mergeKnowledge(existing, d, new Date().toISOString())
              : newKnowledge(id, d, new Date().toISOString()),
          );
        }
      },
    },
  };
}
/**
 * Self-contained fake for the tool-learning tests. Only the writer calls tools;
 * repair preserves node identity so schema carry-forward is exercised.
 */
function toolAgentModel(
  seenRules: string[][],
  { failOnce = false }: { failOnce?: boolean } = {},
): Model {
  let evaluations = 0;
  return {
    async json<T>(system: string, input: unknown): Promise<ModelResult<T>> {
      const data = input as {
        rubric: Criterion[];
        evidence: Observation[];
        workflow: Workflow;
        learnedToolRules?: { claim: string }[];
        observations: Observation[];
      };
      if (system.startsWith('You are an independent')) {
        evaluations++;
        return result({
          checks: data.rubric.map((c) => ({
            criterionId: c.id,
            score: failOnce && evaluations === 1 ? 0.1 : 1,
            rationale: 'Checked source evidence',
            evidenceIds: [
              (
                data.evidence.find((t) => t.kind === 'model') ??
                data.evidence[0]
              ).id,
            ],
          })),
          summary: 'Evaluated',
          issues: [],
          memoryVerdicts: [],
        }) as ModelResult<T>;
      }
      if (system.startsWith('Reflect'))
        return result({
          summary: 'Reflected.',
          repairInstructions: 'Retry with the same agents.',
          memories: [],
        }) as ModelResult<T>;
      // Repair keeps every node byte-identical, so carried schemas stay valid.
      if (system.startsWith('Repair'))
        return result(structuredClone(data.workflow)) as ModelResult<T>;
      if (system.startsWith('You are Writer')) {
        const rules = (data.learnedToolRules ?? []).map((r) => r.claim);
        seenRules.push(rules);
        if (!data.observations.some((t) => t.name === 'DOCS_READ'))
          return result({
            action: 'tool',
            toolSlug: 'DOCS_READ',
            // Without a learned rule the agent guesses the wrong key first.
            argumentsJson: rules.some((r) => r.includes('`id`'))
              ? '{"id":"brief"}'
              : '{"document_id":"brief"}',
            reason: 'Read the supplied source',
            output: '',
          }) as ModelResult<T>;
      }
      return result({
        action: 'finish',
        toolSlug: '',
        argumentsJson: '{}',
        reason: '',
        output: 'Atlas Notes supports offline writing and Markdown export.',
      }) as ModelResult<T>;
    },
  };
}
const docsSchemaTool = (connected = true): DiscoveredTool => ({
  slug: 'DOCS_READ',
  toolkit: 'googledocs',
  description: 'Read a document',
  schema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  readOnly: true,
  connected,
});
function toolDeps(
  seenRules: string[][],
  knowledge: Knowledge | null,
  options: { failOnce?: boolean; connected?: boolean; onSearch?: () => void } = {},
): Dependencies {
  return {
    model: toolAgentModel(seenRules, { failOnce: options.failOnce }),
    knowledge,
    tools: {
      search: async () => {
        options.onSearch?.();
        return [docsSchemaTool(options.connected ?? true)];
      },
      execute: async () => ({ text: 'Atlas Notes ships offline editing.' }),
    },
  };
}
async function toolChat() {
  const c = await setup();
  c.versions[0].workflow.nodes[0].toolkits = ['googledocs'];
  return c;
}
void test('a learned argument shape removes the wasted tool call on a later run', async () => {
  const shared = knowledgeStore();
  const seen: string[][] = [];
  const wasted = (run: Run) =>
    run.attempts
      .flatMap((a) => a.traces)
      .filter((t) => t.error?.includes('failed the discovered JSON schema'))
      .length;
  // Run 1, empty store: the agent guesses `document_id` and the schema rejects it.
  const firstChat = await toolChat();
  const first = await finish(
    firstChat,
    await startRun(firstChat),
    toolDeps(seen, shared.store),
  );
  assert.ok(wasted(first.run) >= 1, 'run 1 should waste a turn');
  assert.ok(shared.written.length > 0, 'run 1 should record what it observed');
  assert.ok(
    seen.every((rules) => rules.length === 0),
    'run 1 had nothing to learn from yet',
  );
  // Corroborate from a second run, exactly as a real repeat would.
  await shared.store.record(
    shared.written
      .filter((d) => d.outcome === 'schema_rejected')
      .slice(0, 1)
      .map((d) => ({ ...d, runId: 'run-corroborating' })),
  );
  assert.ok(
    [...shared.rows.values()].some((r) => r.status === 'confirmed'),
    'a repeated observation should confirm the rule',
  );
  // Run 2 is a DIFFERENT chat: the tool lesson survives task isolation.
  const secondChat = await toolChat();
  const second = await finish(
    secondChat,
    await startRun(secondChat),
    toolDeps(seen, shared.store),
  );
  assert.equal(second.run.status, 'completed');
  assert.equal(wasted(second.run), 0, 'run 2 should not repeat the mistake');
  assert.ok(
    seen.at(-1)!.some((r) => r.includes('DOCS_READ')),
    'the later run should have been given the rule',
  );
  // The task lesson stayed home even though the tool rule travelled.
  assert.equal(retrieveMemory(secondChat, 'Atlas Notes').length, 0);
  assert.equal(secondChat.memory.length, 0);
});
void test('learned rules are withheld when no knowledge store is attached', async () => {
  const seen: string[][] = [];
  const chat = await toolChat();
  await finish(chat, await startRun(chat), toolDeps(seen, null));
  assert.ok(seen.length > 0);
  assert.ok(
    seen.every((rules) => rules.length === 0),
    'a run without a store must see no rules',
  );
});
void test('only tool rules that name a discovered tool and avoid task text escape the chat', async () => {
  const shared = knowledgeStore();
  const chat = await toolChat();
  const brief = 'Atlas Notes supports offline writing and shared notebooks';
  chat.messages.push({
    id: 'brief',
    role: 'user',
    content: brief,
    createdAt: new Date().toISOString(),
  });
  const advanced = await finish(
    chat,
    await startRun(chat),
    toolDeps([], shared.store),
  );
  const attempt = advanced.run.attempts.at(-1)!;
  shared.written.length = 0;
  await promoteToolRules(
    advanced.chat,
    advanced.run,
    attempt,
    { model: model(), tools: null, knowledge: shared.store },
    [
      {
        kind: 'tool_rule',
        content: 'DOCS_READ needs a bare document id, not a share link.',
      },
      { kind: 'tool_rule', content: `DOCS_READ returned that ${brief}.` },
      { kind: 'strategy', content: 'DOCS_READ output should open the brief.' },
      { kind: 'preference', content: 'DOCS_READ results should stay terse.' },
    ],
  );
  // Only the clean tool rule leaves; the echo is dropped and the drop is counted.
  assert.deepEqual(
    shared.written.map((d) => d.claim),
    ['DOCS_READ needs a bare document id, not a share link.'],
  );
  assert.equal(advanced.run.rejectedToolClaims, 1);
  // Non-tool_rule kinds never reach the owner-scoped store at all.
  assert.ok(!shared.written.some((d) => d.claim?.includes('terse')));
});
void test('discovered schemas are reused across repair attempts within one run', async () => {
  let searches = 0;
  const chat = await toolChat();
  // Seed the rule so the tool call succeeds and the test isolates rediscovery.
  const shared = knowledgeStore();
  const seedDraft: ToolKnowledgeDraft = {
    toolkit: 'googledocs',
    slug: 'DOCS_READ',
    kind: 'argument_shape',
    argKeys: ['id'],
    rejectedKeys: [],
    requiredKeys: ['id'],
    errorSignature: null,
    outcome: 'ok',
    evidence: [],
    runId: 'seed-a',
  };
  await shared.store.record([seedDraft]);
  await shared.store.record([{ ...seedDraft, runId: 'seed-b' }]);
  const outcome = await finish(
    chat,
    await startRun(chat),
    toolDeps([], shared.store, { failOnce: true, onSearch: () => searches++ }),
  );
  assert.equal(outcome.run.attempts.length, 2, 'the run should have repaired');
  assert.equal(searches, 1, 'the repair attempt should not rediscover schemas');
  // Reuse is still evidence: attempt 2 carries a search trace and live schemas.
  const second = outcome.run.attempts[1];
  assert.ok(second.traces.some((t) => t.kind === 'search'));
  assert.equal(second.states[0].tools[0].source, 'reuse');
  assert.ok(
    second.traces
      .find((t) => t.kind === 'search')!
      .output.includes('"cached":true'),
  );
});
void test('a carried-forward schema still blocks a disconnected account', async () => {
  let searches = 0;
  const chat = await toolChat();
  const outcome = await finish(
    chat,
    await startRun(chat),
    toolDeps([], null, {
      failOnce: true,
      connected: false,
      onSearch: () => searches++,
    }),
  );
  assert.equal(searches, 1);
  assert.ok(
    outcome.run.attempts.every((a) =>
      a.states.some((s) => s.blockReason === 'connection'),
    ),
    'every attempt must block while the account is disconnected',
  );
  assert.notEqual(outcome.run.status, 'completed');
});
void test('an ablation arm reads frozen memory and never writes back', async () => {
  const chat = await toolChat();
  chat.memory = [
    {
      id: 'm1',
      kind: 'strategy',
      content: 'Ground every Atlas Notes claim in the supplied brief.',
      evidence: ['t1'],
      status: 'supported',
      createdAt: 'now',
      updatedAt: 'now',
      sourceRun: 'run-0',
      supportedRuns: [],
      usedCount: 0,
    },
  ];
  chat.experiment = await planExperiment(chat, 'Fixed input', 1, 'v1', 'now');
  const before = structuredClone(chat.memory);
  const armRun = await startRun(chat, true, 'v1', {
    mode: 'test',
    input: 'Fixed input',
    experimentId: chat.experiment.id,
    arm: 0,
    memoryPool: chat.experiment.memorySnapshot,
  });
  chat.experiment = startArm(chat.experiment, nextArm(chat.experiment)!, armRun.id);
  assert.equal(armRun.inputOrigin, 'user');
  assert.ok(armRun.attempts[0].memoryIds.length, 'the on arm should read memory');
  const outcome = await finish(chat, armRun, {
    model: model(),
    tools: null,
  });
  // Memory is untouched: no new entries, no usage counters, no verdict writes.
  assert.deepEqual(outcome.chat.memory, before);
  // Arm runs stay out of the conversation.
  assert.equal(outcome.chat.messages.filter((m) => m.kind).length, 0);
  const control = await startRun(chat, false, 'v1', {
    mode: 'test',
    input: 'Fixed input',
    experimentId: chat.experiment.id,
    arm: 1,
    memoryPool: chat.experiment.memorySnapshot,
  });
  assert.equal(control.attempts[0].memoryIds.length, 0);
  assert.equal(control.attempts[0].graphDigest, armRun.attempts[0].graphDigest);
});
