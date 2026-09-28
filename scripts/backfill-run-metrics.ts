/**
 * Rebuild `agent_run_metrics` from the runs already stored.
 *
 * The application writes that projection inside `saveChat`, so it only exists
 * for runs that finished through the API. Runs that arrived another way — a
 * seeded demo workspace, a database imported from elsewhere — leave the
 * Learning tab empty even though the evidence is all there. This recomputes the
 * rows with the same pure function the server uses, so the numbers cannot drift
 * from what the product would have recorded itself.
 *
 *   node --experimental-strip-types scripts/backfill-run-metrics.ts <database> [--apply]
 */
import Database from 'better-sqlite3';
import { runMetrics } from '../lib/workbench/metrics.ts';
import type { Run } from '../lib/workbench/types.ts';

const TERMINAL = ['completed', 'exhausted', 'blocked', 'failed'];
const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!file)
  throw new Error('usage: backfill-run-metrics.ts <database> [--apply]');

const db = new Database(file, { readonly: !apply });
const rows = db
  .prepare('SELECT id,owner_id,payload FROM agent_runs')
  .all() as { id: string; owner_id: string; payload: string }[];
const have = new Set(
  (db.prepare('SELECT run_id FROM agent_run_metrics').all() as { run_id: string }[])
    .map((r) => r.run_id),
);

const insert = db.prepare(
  'INSERT INTO agent_run_metrics(run_id,owner_id,chat_id,experiment_id,arm,use_memory,status,attempts,passed,score,input_tokens,output_tokens,cost_usd,duration_ms,tool_calls,tool_errors,search_calls,search_cached,graph_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO NOTHING',
);
let written = 0,
  skipped = 0,
  failed = 0;
for (const row of rows) {
  if (have.has(row.id)) {
    skipped++;
    continue;
  }
  let run: Run;
  try {
    run = JSON.parse(row.payload) as Run;
  } catch {
    failed++;
    continue;
  }
  // Manual executions are deliberately excluded from test pass rates, exactly
  // as saveChat excludes them.
  if (run.mode === 'manual' || !TERMINAL.includes(run.status)) {
    skipped++;
    continue;
  }
  try {
    const m = runMetrics(run);
    if (apply)
      insert.run(
        m.runId, row.owner_id, m.chatId, m.experimentId, m.arm,
        m.useMemory ? 1 : 0, m.status, m.attempts, m.passed ? 1 : 0, m.score,
        m.inputTokens, m.outputTokens, m.costUsd, m.durationMs, m.toolCalls,
        m.toolErrors, m.searchCalls, m.searchCached, m.graphDigest, m.createdAt,
      );
    written++;
  } catch (error) {
    failed++;
    console.error(`  could not summarize ${row.id}:`, (error as Error).message);
  }
}
console.log(
  `${apply ? 'wrote' : 'would write'} ${written}, skipped ${skipped}, failed ${failed}`,
);
if (!apply) console.log('Dry run. Re-run with --apply to write the rows.');
db.close();
