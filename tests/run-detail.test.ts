import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DETAILED_RUNS, trimRunDetail, withoutTraces } from '../lib/workbench/run-detail.ts';
import { emptyUsage, type Observation, type Run } from '../lib/workbench/types.ts';

const trace = (id: string): Observation => ({
  id,
  nodeId: 'writer',
  kind: 'model',
  name: 'Writer',
  input: 'x'.repeat(2000),
  output: 'y'.repeat(2000),
  durationMs: 1,
  error: null,
  usage: emptyUsage(),
  at: '2026-01-01T00:00:00.000Z',
  langsmith: 'disabled',
});
function run(id: string, status: Run['status'] = 'completed'): Run {
  return {
    id,
    chatId: 'chat',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status,
    phase: 'done',
    mode: 'test',
    attempts: [
      {
        id: `${id}-a1`,
        iteration: 1,
        workflow: { title: 't', explanation: 'e', nodes: [], criteria: [] },
        graphDigest: 'd',
        states: [],
        traces: [trace(`${id}-t1`), trace(`${id}-t2`)],
        evaluation: null,
        memoryIds: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: null,
      },
    ],
    rubric: [],
    target: 0.85,
    maxIterations: 3,
    maxToolCalls: 16,
    pending: null,
    usage: emptyUsage(),
    error: null,
    useMemory: true,
  };
}

void test('the newest runs keep their step log and older ones do not', () => {
  const runs = Array.from({ length: 10 }, (_, i) => run(`r${i}`));
  const trimmed = trimRunDetail(runs);
  assert.equal(trimmed.length, 10);
  for (const r of trimmed.slice(0, DETAILED_RUNS)) {
    assert.equal(r.tracesOmitted, undefined);
    assert.equal(r.attempts[0].traces.length, 2);
  }
  for (const r of trimmed.slice(DETAILED_RUNS)) {
    assert.equal(r.tracesOmitted, true);
    assert.equal(r.attempts[0].traces.length, 0);
  }
});

void test('an active run keeps its traces however old it is', () => {
  // The conversation renders a running step log live; trimming it by position
  // would blank the view the person is actually watching.
  const runs = [...Array.from({ length: 9 }, (_, i) => run(`r${i}`)), run('live', 'running')];
  const trimmed = trimRunDetail(runs);
  const live = trimmed.find((r) => r.id === 'live')!;
  assert.equal(live.tracesOmitted, undefined);
  assert.equal(live.attempts[0].traces.length, 2);
  for (const status of ['paused', 'awaiting_approval'] as const) {
    const held = trimRunDetail([
      ...Array.from({ length: 9 }, (_, i) => run(`r${i}`)),
      run('held', status),
    ]).find((r) => r.id === 'held')!;
    assert.equal(held.tracesOmitted, undefined, status);
  }
});

void test('trimming never mutates the run it was given', () => {
  // The caller holds the same objects it just saved to the database.
  const original = run('r0');
  const trimmed = withoutTraces(original);
  assert.equal(original.attempts[0].traces.length, 2);
  assert.equal(original.tracesOmitted, undefined);
  assert.equal(trimmed.attempts[0].traces.length, 0);
});

void test('a short history is returned untouched', () => {
  const runs = [run('a'), run('b')];
  assert.deepEqual(trimRunDetail(runs), runs);
  assert.equal(trimRunDetail([]).length, 0);
});

void test('everything except the step log survives trimming', () => {
  const [trimmed] = trimRunDetail([run('r0')], 0);
  assert.equal(trimmed.id, 'r0');
  assert.equal(trimmed.status, 'completed');
  assert.equal(trimmed.attempts.length, 1);
  assert.equal(trimmed.attempts[0].graphDigest, 'd');
  assert.equal(trimmed.useMemory, true);
});
