/**
 * Copy a SQLite workspace database into Cloud SQL.
 *
 * Tables are copied parents-first so the foreign keys hold as we go. Every row
 * is inserted with ON CONFLICT DO NOTHING, so a re-run after a partial copy
 * resumes instead of failing — and never overwrites a row the live application
 * has since changed.
 *
 *   DATABASE_URL=postgres://... node scripts/migrate-to-postgres.mjs <sqlite> [--apply]
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresD1 } from '../server/d1-postgres.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!file) throw new Error('usage: migrate-to-postgres.mjs <sqlite-file> [--apply]');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL.');

// Parents before children: sessions reference users, agent_runs reference chats.
const ORDER = [
  'users',
  'sessions',
  'auth_throttle',
  'chats',
  'agent_runs',
  'agent_run_metrics',
  'integration_sessions',
  'tool_receipts',
  'tool_knowledge',
  'tool_schema_cache',
  'workflow_publications',
];
// Columns the SQLite side may not have, because they were added late. A missing
// one is filled from the payload rather than left null, or the sidebar would
// show every workflow as having no steps and no latest run.
const DERIVED = {
  chats: ['steps'],
  agent_runs: ['mode', 'error', 'pending_status'],
};

const sqlite = new Database(file, { readonly: true });
const pg = new PostgresD1({ connectionString: process.env.DATABASE_URL });
await pg.exec(readFileSync(join(here, '..', 'server', 'schema.postgres.sql'), 'utf8'));

function sqliteColumns(table) {
  return sqlite.prepare(`PRAGMA table_info('${table}')`).all().map((c) => c.name);
}
function derive(table, row) {
  if (table === 'chats' && (row.steps === undefined || row.steps === null)) {
    try {
      const chat = JSON.parse(row.payload);
      row.steps = chat.versions?.at(-1)?.workflow?.nodes?.length ?? 0;
    } catch {
      row.steps = 0;
    }
  }
  if (table === 'agent_runs' && row.mode === undefined) {
    try {
      const run = JSON.parse(row.payload);
      row.mode = run.mode ?? null;
      row.error = run.error ?? null;
      row.pending_status = run.pending?.status ?? null;
    } catch {
      row.mode = row.error = row.pending_status = null;
    }
  }
  return row;
}

let total = 0;
for (const table of ORDER) {
  const exists = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  if (!exists) {
    console.log(`${table.padEnd(24)} (absent in source)`);
    continue;
  }
  const present = sqliteColumns(table);
  const columns = [...present, ...(DERIVED[table] ?? []).filter((c) => !present.includes(c))];
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all().map((r) => derive(table, { ...r }));
  if (!rows.length) {
    console.log(`${table.padEnd(24)} 0`);
    continue;
  }
  if (apply) {
    const sql = `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT DO NOTHING`;
    // One transaction per table: a failure leaves that table untouched rather
    // than half-copied.
    await pg.batch(rows.map((r) => pg.prepare(sql).bind(...columns.map((c) => r[c] ?? null))));
  }
  total += rows.length;
  console.log(`${table.padEnd(24)} ${rows.length}${apply ? '' : ' (dry run)'}`);
}
console.log(`\n${apply ? 'copied' : 'would copy'} ${total} rows`);
if (apply) {
  console.log('\nverifying counts in Postgres:');
  for (const table of ORDER) {
    const row = await pg.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first();
    console.log(`  ${table.padEnd(24)} ${row.n}`);
  }
}
sqlite.close();
await pg.close();
