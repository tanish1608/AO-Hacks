import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat, startRun } from '../lib/workbench/engine.ts';
import {
  advanceResilient,
  recoverRead,
  type RecoveryEvent,
} from '../lib/workbench/recovery.ts';
import {
  runRecoveryChecks,
  recoveryCheckMessage,
} from '../lib/workbench/recovery-checks.ts';
import {
  emptyUsage,
  type Dependencies,
  type DiscoveredTool,
  type Workflow,
} from '../lib/workbench/types.ts';
import {
  combineRunInput,
  validateDocument,
  validateExtractedText,
} from '../lib/workbench/documents.ts';
const tool: DiscoveredTool = {
  slug: 'GOOGLEDOCS_GET_DOCUMENT_BY_ID',
  toolkit: 'googledocs',
  description: 'Read a document',
  readOnly: true,
  connected: true,
  schema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
};
async function fixture(mode: 'test' | 'manual' = 'test') {
  const chat = createChat('recovery-fixture');
  const workflow: Workflow = {
    title: 'Document summary',
    explanation: 'Read and summarize',
    nodes: [
      {
        id: 'reader',
        name: 'Reader',
        role: 'Read',
        instruction: 'Read document',
        toolkits: ['googledocs'],
        dependsOn: [],
      },
      {
        id: 'writer',
        name: 'Writer',
        role: 'Summarize',
        instruction: 'Summarize',
        toolkits: [],
        dependsOn: ['reader'],
      },
    ],
    criteria: [
      {
        id: 'grounded',
        name: 'Grounded',
        description: 'Use source',
        weight: 1,
        required: true,
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Deliver summary',
        weight: 1,
        required: true,
      },
    ],
  };
  chat.versions = [
    {
      id: 'v1',
      workflow,
      digest: 'fixture',
      createdAt: chat.createdAt,
      reason: 'Fixture',
    },
  ];
  const run = await startRun(chat, true, undefined, {
    mode,
    input: 'Document 42',
  });
  run.attempts[0].states[0].tools = [tool];
  return { chat, run };
}
function dependencies(
  call: () => Promise<unknown>,
  args = '{"id":"42"}',
): Dependencies {
  return {
    model: {
      json: async <T>() => ({
        value: {
          action: 'tool',
          toolSlug: tool.slug,
          argumentsJson: args,
          reason: 'Read input',
          output: '',
        } as T,
        usage: emptyUsage(),
        durationMs: 1,
      }),
    },
    tools: { search: async () => [tool], execute: call },
  };
}
void test('in-app recovery checks execute and report actual deterministic outcomes', async () => {
  const r = await runRecoveryChecks();
  assert.equal(r.results.length, 6);
  assert.ok(r.results.every((x) => x.passed));
  assert.match(recoveryCheckMessage(r), /6\/6 passed/);
});
void test('transient read recovers in same step and records recovery in chat', async () => {
  const { chat, run } = await fixture();
  let calls = 0;
  const out = await advanceResilient(
    chat,
    run,
    dependencies(async () => {
      if (++calls === 1) throw new Error('Composio HTTP 503: outage');
      return 'source';
    }),
    async () => {},
  );
  assert.equal(calls, 2);
  assert.equal(out.run.status, 'running');
  assert.ok(
    out.chat.messages.some((m) =>
      m.content.includes('succeeded after 1 retries'),
    ),
  );
  assert.equal(
    out.run.attempts[0].traces.filter(
      (t) => t.name === 'Recovery: additional tool read',
    ).length,
    1,
  );
  assert.equal(out.run.usage.inputTokens, 0);
});
void test('authorization rejection stops immediately and preserves partial artifacts', async () => {
  const { chat, run } = await fixture();
  run.attempts[0].states[1].output = 'Partial draft';
  let calls = 0;
  const out = await advanceResilient(
    chat,
    run,
    dependencies(async () => {
      calls++;
      throw new Error('Composio HTTP 403: forbidden');
    }),
    async () => {},
  );
  assert.equal(calls, 1);
  assert.equal(out.run.status, 'blocked');
  assert.equal(out.run.phase, 'done');
  assert.equal(out.run.attempts[0].states[1].output, 'Partial draft');
  assert.match(out.chat.messages.at(-1)!.content, /Reconnect/);
});
void test('repeat failed read is stopped before a second external dispatch', async () => {
  let s = await fixture(),
    calls = 0;
  const d = dependencies(async () => {
    calls++;
    throw new Error('Invalid resource format');
  });
  s = await advanceResilient(s.chat, s.run, d, async () => {});
  s = await advanceResilient(s.chat, s.run, d, async () => {});
  assert.equal(calls, 1);
  assert.equal(s.run.status, 'blocked');
  assert.ok(s.chat.messages.some((m) => m.content.includes('stagnation')));
});
void test('identical invalid schema arguments stop without external dispatch', async () => {
  let s = await fixture(),
    calls = 0;
  const d = dependencies(async () => {
    calls++;
    return {};
  }, '{"id":3}');
  s = await advanceResilient(s.chat, s.run, d, async () => {});
  assert.equal(s.run.status, 'running');
  s = await advanceResilient(s.chat, s.run, d, async () => {});
  assert.equal(calls, 0);
  assert.equal(s.run.status, 'blocked');
});
void test('manual recovery retains logs but does not add chat events', async () => {
  const { chat, run } = await fixture('manual');
  let calls = 0;
  const out = await advanceResilient(
    chat,
    run,
    dependencies(async () => {
      if (++calls === 1) throw new Error('Composio HTTP 503: outage');
      return 'source';
    }),
    async () => {},
  );
  assert.equal(calls, 2);
  assert.equal(out.chat.messages.length, 0);
  assert.ok(
    out.run.attempts[0].traces.some((t) => t.name.includes('Recovery')),
  );
});
void test('transport retry ceiling respects remaining tool-call budget', async () => {
  const { chat, run } = await fixture();
  run.maxToolCalls = 1;
  let calls = 0;
  const out = await advanceResilient(
    chat,
    run,
    dependencies(async () => {
      calls++;
      throw new Error('Composio HTTP 503: outage');
    }),
    async () => {},
  );
  assert.equal(calls, 1);
  assert.equal(out.run.status, 'blocked');
});
void test('mutating call never retries even for transient provider failure', async () => {
  let calls = 0;
  const events: RecoveryEvent[] = [];
  await assert.rejects(() =>
    recoverRead(
      async () => {
        calls++;
        throw new Error('Composio HTTP 503: timeout');
      },
      false,
      (e) => events.push(e),
      async () => {},
    ),
  );
  assert.equal(calls, 1);
  assert.equal(events.length, 0);
});
void test('document input keeps reviewed text and rejects silent truncation', () => {
  assert.equal(
    combineRunInput('Summarize', [
      { name: 'brief.txt', text: 'Release on Friday', size: 20 },
    ]),
    'Summarize\n\nDocument: brief.txt\nRelease on Friday',
  );
  assert.throws(
    () => combineRunInput('x'.repeat(12001), []),
    /limit is 12,000/,
  );
  assert.throws(() => validateDocument('script.exe', 10));
  assert.throws(() => validateDocument('a.pdf', 11 * 1024 * 1024));
  assert.throws(() => validateExtractedText(' \u0000 '), /No readable text/);
});
