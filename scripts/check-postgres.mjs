/**
 * Exercise the statements the application actually issues against a real
 * Postgres, before any of it is deployed.
 *
 * The one that genuinely worries me is `INSERT INTO t(cols) SELECT ?,?,... WHERE
 * EXISTS(...)`: Postgres has to infer each parameter's type from the target
 * column list, and where it cannot it fails with "could not determine data type
 * of parameter". SQLite never cared. Three of our writes use that shape,
 * including the guarded run insert that the whole concurrency scheme rests on.
 *
 *   DATABASE_URL=... node scripts/check-postgres.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresD1 } from '../server/d1-postgres.mjs';

const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL.');
const db = new PostgresD1({ connectionString: process.env.DATABASE_URL });
await db.exec(readFileSync(join(here, '..', 'server', 'schema.postgres.sql'), 'utf8'));

const owner = `check-${crypto.randomUUID()}`;
const chatId = crypto.randomUUID();
const runId = crypto.randomUUID();
const at = new Date().toISOString();
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

try {
  // Plain insert with a derived column.
  await db
    .prepare(
      'INSERT INTO chats(id,owner_id,title,revision,payload,steps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    .bind(chatId, owner, 'Check', 0, JSON.stringify({ id: chatId }), 3, at, at)
    .run();
  check('insert chat', true);

  // The lease: a conditional UPDATE whose changes count drives 409 handling.
  const lease = await db
    .prepare(
      'UPDATE chats SET lease_token=?,lease_until=? WHERE id=? AND owner_id=? AND revision=? AND (lease_until IS NULL OR lease_until<?)',
    )
    .bind('token', Date.now() + 180000, chatId, owner, 0, Date.now())
    .run();
  check('lease takes', lease.meta.changes === 1);
  const again = await db
    .prepare(
      'UPDATE chats SET lease_token=?,lease_until=? WHERE id=? AND owner_id=? AND revision=? AND (lease_until IS NULL OR lease_until<?)',
    )
    .bind('other', Date.now() + 180000, chatId, owner, 0, Date.now())
    .run();
  check('a held lease is refused', again.meta.changes === 0);

  // The shape that had to be proven: parameters inside INSERT ... SELECT.
  const guarded = await db
    .prepare(
      'INSERT INTO agent_runs(id,chat_id,owner_id,status,payload,mode,error,pending_status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chats WHERE id=? AND owner_id=? AND revision=?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,mode=excluded.mode,error=excluded.error,pending_status=excluded.pending_status,updated_at=excluded.updated_at',
    )
    .bind(runId, chatId, owner, 'completed', '{}', 'test', null, null, at, at, chatId, owner, 0)
    .run();
  check('guarded run insert', guarded.meta.changes === 1);

  const blocked = await db
    .prepare(
      'INSERT INTO agent_runs(id,chat_id,owner_id,status,payload,mode,error,pending_status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chats WHERE id=? AND owner_id=? AND revision=?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at',
    )
    .bind(crypto.randomUUID(), chatId, owner, 'completed', '{}', 'test', null, null, at, at, chatId, owner, 99)
    .run();
  check('guard rejects a stale revision', blocked.meta.changes === 0);

  // Sign-up's race guard.
  const userId = crypto.randomUUID();
  const email = `${owner}@example.com`;
  const first = await db
    .prepare(
      'INSERT INTO users(id,email,name,password_hash,google_sub,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM users WHERE email=? OR google_sub=?)',
    )
    .bind(userId, email, 'Check', 'none', null, at, at, email, 'sub-x')
    .run();
  const second = await db
    .prepare(
      'INSERT INTO users(id,email,name,password_hash,google_sub,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM users WHERE email=? OR google_sub=?)',
    )
    .bind(crypto.randomUUID(), email, 'Check', 'none', null, at, at, email, 'sub-y')
    .run();
  check('duplicate signup is refused', first.meta.changes === 1 && second.meta.changes === 0);

  // Upsert with a CASE referencing the existing row.
  for (let i = 0; i < 2; i++)
    await db
      .prepare(
        'INSERT INTO auth_throttle(key,failures,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN auth_throttle.reset_at<? THEN 1 ELSE auth_throttle.failures+1 END,reset_at=?',
      )
      .bind(owner, at, at, at)
      .run();
  const throttle = await db
    .prepare('SELECT failures FROM auth_throttle WHERE key=?')
    .bind(owner)
    .first();
  check('throttle upsert increments', Number(throttle.failures) === 2, `failures=${throttle.failures}`);

  // The sidebar listing, including the correlated subquery and LEFT JOIN.
  const listing = await db
    .prepare(
      `SELECT c.id,c.title,c.updated_at,c.steps,
        r.id AS run_id,r.status AS run_status,r.mode AS run_mode,
        r.error AS run_error,r.updated_at AS run_updated,r.pending_status
       FROM chats c
       LEFT JOIN agent_runs r ON r.id=(
         SELECT r2.id FROM agent_runs r2
         WHERE r2.chat_id=c.id AND r2.owner_id=c.owner_id
         ORDER BY CASE WHEN r2.pending_status IN ('unknown','executing') THEN 0
           WHEN r2.status IN ('running','paused','awaiting_approval') THEN 1 ELSE 2 END,
           r2.created_at DESC,r2.id DESC LIMIT 1)
       WHERE c.owner_id=? ORDER BY c.updated_at DESC LIMIT 100`,
    )
    .bind(owner)
    .all();
  const row = listing.results[0];
  check(
    'sidebar listing joins the latest run',
    listing.results.length === 1 && row.run_id === runId && Number(row.steps) === 3,
    `steps=${row?.steps} run=${row?.run_id === runId}`,
  );

  // Numeric columns must come back as numbers, not strings.
  await db
    .prepare(
      'INSERT INTO agent_run_metrics(run_id,owner_id,chat_id,experiment_id,arm,use_memory,status,attempts,passed,score,input_tokens,output_tokens,cost_usd,duration_ms,tool_calls,tool_errors,search_calls,search_cached,graph_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO NOTHING',
    )
    .bind(runId, owner, chatId, null, null, 1, 'completed', 2, 1, 0.85, 100, 50, 0.0123, 4567, 3, 0, 1, 0, 'digest', at)
    .run();
  const metric = await db
    .prepare('SELECT score,cost_usd,duration_ms,use_memory FROM agent_run_metrics WHERE run_id=?')
    .bind(runId)
    .first();
  check(
    'numeric columns read back as numbers',
    typeof metric.score === 'number' &&
      typeof metric.cost_usd === 'number' &&
      typeof metric.duration_ms === 'number' &&
      Math.abs(metric.score - 0.85) < 1e-9,
    `score=${typeof metric.score} cost=${typeof metric.cost_usd} duration=${typeof metric.duration_ms}`,
  );

  // A batch is one transaction: a failing statement must roll the rest back.
  await db.batch([
    db.prepare('UPDATE chats SET title=? WHERE id=?').bind('batched', chatId),
    db.prepare('UPDATE chats SET revision=? WHERE id=?').bind(1, chatId),
  ]);
  const batched = await db.prepare('SELECT title,revision FROM chats WHERE id=?').bind(chatId).first();
  check('batch commits together', batched.title === 'batched' && Number(batched.revision) === 1);

  let rolledBack = false;
  try {
    await db.batch([
      db.prepare('UPDATE chats SET title=? WHERE id=?').bind('should-not-persist', chatId),
      db.prepare('INSERT INTO chats(id,owner_id,title,revision,payload,steps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .bind(chatId, owner, 'dup', 0, '{}', 0, at, at),
    ]);
  } catch {
    rolledBack = true;
  }
  const after = await db.prepare('SELECT title FROM chats WHERE id=?').bind(chatId).first();
  check('a failed batch rolls back', rolledBack && after.title === 'batched', `title=${after.title}`);
} finally {
  // Leave nothing behind: this runs against the real database.
  await db.prepare('DELETE FROM agent_run_metrics WHERE owner_id=?').bind(owner).run().catch(() => {});
  await db.prepare('DELETE FROM agent_runs WHERE owner_id=?').bind(owner).run().catch(() => {});
  await db.prepare('DELETE FROM chats WHERE owner_id=?').bind(owner).run().catch(() => {});
  await db.prepare('DELETE FROM users WHERE email=?').bind(`${owner}@example.com`).run().catch(() => {});
  await db.prepare('DELETE FROM auth_throttle WHERE key=?').bind(owner).run().catch(() => {});
  await db.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
