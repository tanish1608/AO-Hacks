/**
 * Seed the finance workflow library.
 *
 * Every workflow here is designed by the real model against the real prompt —
 * none of the graphs are hand-written — so what lands in the workspace is what
 * the product would have produced for that request. Workflows that need a
 * connected account are designed but not executed: without an authorized
 * account the run would block on the connection check, which is correct
 * behaviour and useless as a demo. Tool-free ones are designed and then tested
 * end to end so their runs carry real evidence.
 *
 *   DEMO_DB=.data/foundry.sqlite DEMO_OWNER=<id> \
 *   node --experimental-strip-types scripts/finance-workflows.ts [--test] [--only=id,id]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { SqliteD1 } from '../server/d1-sqlite.mjs';
import { createChat, design, startRun, announceTest } from '../lib/workbench/engine.ts';
import { advanceResilient } from '../lib/workbench/recovery.ts';
import { workbenchModel } from '../lib/workbench/model.ts';
import { runMetrics } from '../lib/workbench/metrics.ts';
import { DEFAULT_MODEL } from '../lib/workbench/models.ts';
import type { Chat, Run } from '../lib/workbench/types.ts';

const TERMINAL = ['completed', 'exhausted', 'blocked', 'failed'];
type Fixture = {
  id: string;
  title: string;
  description: string;
  apps: string[];
  prompt: string;
};
const fixtures = JSON.parse(
  readFileSync('lib/workbench/finance-workflows.json', 'utf8'),
) as Fixture[];

const vars = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
const dbPath = process.env.DEMO_DB;
if (!dbPath) throw Error('Set DEMO_DB to the database to seed.');
const owner = process.env.DEMO_OWNER;
if (!owner) throw Error('Set DEMO_OWNER to the account id that should own these.');
const runTests = process.argv.includes('--test');
const only = process.argv
  .find((a) => a.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',')
  .filter(Boolean);

const db = new SqliteD1(dbPath).db;
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
const model = workbenchModel({ ...vars, ...process.env }, fetch, DEFAULT_MODEL);

// One call at a time with a pause between: this walks a provider's rate limit
// otherwise, and a 429 halfway through a seeding run is expensive to redo.
let queue = Promise.resolve();
const deps = {
  model: {
    async json<T>(system: string, input: unknown, schema: Record<string, unknown>) {
      const slot = queue.then(() => new Promise<void>((r) => setTimeout(r, 2500)));
      queue = slot;
      await slot;
      return model.json<T>(system, input, schema);
    },
  },
  tools: null,
};

mkdirSync('outputs/finance-workflows', { recursive: true });

function save(chat: Chat, runs: Run[]) {
  db.transaction(() => {
    db.prepare(
      'INSERT INTO chats(id,owner_id,title,revision,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at',
    ).run(chat.id, owner, chat.title, chat.revision, JSON.stringify(chat), chat.createdAt, chat.updatedAt);
    for (const r of runs) {
      db.prepare(
        'INSERT INTO agent_runs(id,chat_id,owner_id,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at',
      ).run(r.id, chat.id, owner, r.status, JSON.stringify(r), r.createdAt, r.updatedAt);
      if (r.mode === 'manual' || !TERMINAL.includes(r.status)) continue;
      const m = runMetrics(r);
      db.prepare(
        'INSERT INTO agent_run_metrics(run_id,owner_id,chat_id,experiment_id,arm,use_memory,status,attempts,passed,score,input_tokens,output_tokens,cost_usd,duration_ms,tool_calls,tool_errors,search_calls,search_cached,graph_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status,attempts=excluded.attempts,passed=excluded.passed,score=excluded.score,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,cost_usd=excluded.cost_usd,duration_ms=excluded.duration_ms,tool_calls=excluded.tool_calls,tool_errors=excluded.tool_errors,search_calls=excluded.search_calls,search_cached=excluded.search_cached',
      ).run(
        m.runId, owner, m.chatId, m.experimentId, m.arm, m.useMemory ? 1 : 0,
        m.status, m.attempts, m.passed ? 1 : 0, m.score, m.inputTokens,
        m.outputTokens, m.costUsd, m.durationMs, m.toolCalls, m.toolErrors,
        m.searchCalls, m.searchCached, m.graphDigest, m.createdAt,
      );
    }
  })();
}

const report: Record<string, unknown>[] = [];
for (const fixture of fixtures) {
  if (only && !only.includes(fixture.id)) continue;
  const path = `outputs/finance-workflows/${fixture.id}.json`;
  if (existsSync(path) && process.argv.includes('--resume')) {
    const prior = JSON.parse(readFileSync(path, 'utf8'));
    save(prior.chat, prior.runs ?? []);
    report.push(prior.report);
    console.log(`resumed  ${fixture.id}`);
    continue;
  }
  const started = Date.now();
  try {
    let chat = await design(createChat(crypto.randomUUID()), fixture.prompt, deps, fixture.apps);
    chat.title = fixture.title;
    chat.selectedApps = fixture.apps;
    chat.settings = { ...chat.settings, model: DEFAULT_MODEL, maxIterations: 2 };
    const workflow = chat.versions.at(-1)!.workflow;
    const runs: Run[] = [];

    // A workflow that needs an account cannot be executed here; the connection
    // check would block it, which is the right answer and a useless demo.
    const needsAccounts = fixture.apps.length > 0;
    if (runTests && !needsAccounts) {
      let run = await startRun(chat, true, undefined, { mode: 'test', generateInput: true });
      announceTest(chat, run);
      for (let step = 0; step < 30 && run.status === 'running'; step++) {
        const next = await advanceResilient(chat, run, deps);
        chat = next.chat;
        run = next.run;
      }
      runs.push(run);
    }
    save(chat, runs);
    const entry = {
      id: fixture.id,
      title: fixture.title,
      apps: fixture.apps,
      nodes: workflow.nodes.map((n) => ({ id: n.id, name: n.name, toolkits: n.toolkits })),
      criteria: workflow.criteria.map((c) => ({ name: c.name, kind: c.assertion?.kind ?? 'rubric' })),
      tested: runs.length > 0,
      status: (runs[0]?.status ?? 'designed') as string,
      score: runs[0] ? (runMetrics(runs[0]).score ?? null) : null,
      attempts: runs[0]?.attempts.length ?? 0,
      costUsd: runs[0]?.usage.costUsd ?? chat.modelUsage.costUsd,
      error: runs[0]?.error ?? null,
      seconds: Math.round((Date.now() - started) / 1000),
    };
    writeFileSync(path, JSON.stringify({ chat, runs, report: entry }, null, 2));
    report.push(entry);
    console.log(
      `${entry.status.padEnd(9)} ${fixture.id.padEnd(22)} ${workflow.nodes.length} agents  ${entry.seconds}s`,
    );
  } catch (error) {
    const entry = { id: fixture.id, title: fixture.title, failed: (error as Error).message };
    report.push(entry);
    console.error(`FAILED   ${fixture.id}: ${(error as Error).message}`);
  }
}
writeFileSync('outputs/finance-workflows/report.json', JSON.stringify(report, null, 2));
console.log(`\n${report.length} workflows written to ${dbPath}`);
db.close();
