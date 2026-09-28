/**
 * Install the seeded workflow library into a database.
 *
 * Reads `outputs/finance-workflows/<id>.json`, which holds exactly one chat per
 * fixture, and writes each under a stable id derived from the fixture rather
 * than the random one the seeder generated. Re-running the seeder therefore
 * replaces a workflow instead of adding a second copy of it — which is what
 * happened while getting the model settings right, and left three identical
 * "Review invoices before payment" workflows in the workspace.
 *
 * Prior runs for a reinstalled workflow are removed first, so a workflow's
 * history reflects the seeding that produced it rather than accumulating every
 * attempt across every seeding pass.
 *
 * Writes through the same D1 surface the application uses, so it targets a
 * SQLite file or Cloud SQL depending on DATABASE_URL.
 *
 * `--replace` makes the library authoritative: any other workflow owned by that
 * account is removed, so re-seeding leaves exactly the fixtures on disk.
 *
 *   node scripts/install-workflows.mjs [sqlite] --owner <id> [--replace] [--apply]
 */
import { SqliteD1 } from '../server/d1-sqlite.mjs';
import { PostgresD1 } from '../server/d1-postgres.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--owner');
const owner = args[args.indexOf('--owner') + 1];
const apply = args.includes('--apply');
const replace = args.includes('--replace');
if (!owner) throw new Error('usage: install-workflows.mjs [sqlite] --owner <id> [--replace] [--apply]');
if (!file && !process.env.DATABASE_URL)
  throw new Error('Give a SQLite file or set DATABASE_URL.');

const dir = 'outputs/finance-workflows';
if (!existsSync(dir)) throw new Error(`${dir} not found — run scripts/finance-workflows.ts first`);
const db = process.env.DATABASE_URL
  ? new PostgresD1({ connectionString: process.env.DATABASE_URL })
  : new SqliteD1(file);
console.log(process.env.DATABASE_URL ? 'target: Cloud SQL' : `target: ${file}`);

/** Children before parents: agent_runs references chats. */
async function removeChat(id) {
  for (const sql of [
    'DELETE FROM agent_run_metrics WHERE chat_id=?',
    'DELETE FROM agent_runs WHERE chat_id=?',
    'DELETE FROM workflow_publications WHERE chat_id=?',
    'DELETE FROM chats WHERE id=?',
  ])
    await db.prepare(sql).bind(id).run();
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'report.json');
let installed = 0;
const plan = [];
for (const name of files.sort()) {
  const fixtureId = name.replace(/\.json$/, '');
  const data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  if (!data.chat) continue;
  plan.push({ fixtureId, id: `wf-${fixtureId}`, title: data.chat.title, runs: (data.runs ?? []).length, data });
}

console.log(`owner ${owner}`);
for (const p of plan)
  console.log(`  ${p.id.padEnd(28)} ${String(p.runs).padStart(2)} run(s)  ${p.title}`);

const keep = new Set(plan.map((p) => p.id));
const existing = await db
  .prepare('SELECT id,title FROM chats WHERE owner_id=?')
  .bind(owner)
  .all();
const stale = existing.results.filter((c) => !keep.has(c.id));
if (replace && stale.length) {
  console.log(`\nremoving ${stale.length} workflow(s) not in the library:`);
  for (const c of stale) console.log(`  ${c.title}`);
} else if (stale.length) {
  console.log(`\n${stale.length} other workflow(s) will be left alone (pass --replace to remove them)`);
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply.');
  process.exit(0);
}

if (replace) for (const c of stale) await removeChat(c.id);
for (const { id, data } of plan) {
  {
    const chat = { ...data.chat, id };
    await removeChat(id);
    await db.prepare(
      'INSERT INTO chats(id,owner_id,title,revision,payload,steps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    ).bind(
      id,
      owner,
      chat.title,
      chat.revision ?? 0,
      JSON.stringify(chat),
      chat.versions?.at(-1)?.workflow?.nodes?.length ?? 0,
      chat.createdAt,
      chat.updatedAt,
    ).run();
    for (const run of data.runs ?? []) {
      const r = { ...run, chatId: id };
      // The same run id may still be attached to a chat from an earlier
      // seeding pass, so clear it by id rather than relying on the chat sweep.
      await db.prepare('DELETE FROM agent_run_metrics WHERE run_id=?').bind(r.id).run();
      await db.prepare('DELETE FROM agent_runs WHERE id=?').bind(r.id).run();
      await db.prepare(
        'INSERT INTO agent_runs(id,chat_id,owner_id,status,payload,mode,error,pending_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        r.id, id, owner, r.status, JSON.stringify(r),
        r.mode ?? null, r.error ?? null, r.pending?.status ?? null,
        r.createdAt, r.updatedAt,
      ).run();
    }
    installed++;
  }
}
console.log(`\ninstalled ${installed} workflow(s)`);
const rows = await db.prepare('SELECT id,title,steps FROM chats WHERE owner_id=? ORDER BY created_at').bind(owner).all();
console.log(`\nworkspace now holds ${rows.results.length}:`);
for (const r of rows.results) console.log(`  ${String(r.steps).padStart(2)} agents  ${r.title}`);
await db.close?.();
