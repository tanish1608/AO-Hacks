import { strict as assert } from 'node:assert';
import test from 'node:test';
import { toPositional } from '../server/d1-postgres.mjs';

void test('placeholders become positional in order', () => {
  assert.equal(
    toPositional('SELECT payload FROM chats WHERE id=? AND owner_id=?'),
    'SELECT payload FROM chats WHERE id=$1 AND owner_id=$2',
  );
  assert.equal(
    toPositional('INSERT INTO t(a,b,c) VALUES(?,?,?)'),
    'INSERT INTO t(a,b,c) VALUES($1,$2,$3)',
  );
  assert.equal(toPositional('SELECT 1'), 'SELECT 1');
});

void test('a question mark inside a string literal is left alone', () => {
  // Rewriting one of these would shift every later placeholder by one and bind
  // the wrong values to the wrong columns — silent, not a crash.
  assert.equal(
    toPositional("SELECT * FROM t WHERE note='why?' AND id=?"),
    "SELECT * FROM t WHERE note='why?' AND id=$1",
  );
  assert.equal(
    toPositional(`SELECT * FROM t WHERE label="a?b" AND id=?`),
    `SELECT * FROM t WHERE label="a?b" AND id=$1`,
  );
});

void test('an escaped quote does not end the literal early', () => {
  assert.equal(
    toPositional("SELECT * FROM t WHERE s='it''s a ?' AND id=?"),
    "SELECT * FROM t WHERE s='it''s a ?' AND id=$1",
  );
});

void test('the real statements from the store translate correctly', () => {
  const lease = toPositional(
    'UPDATE chats SET lease_token=?,lease_until=? WHERE id=? AND owner_id=? AND revision=? AND (lease_until IS NULL OR lease_until<?)',
  );
  assert.equal(
    lease,
    'UPDATE chats SET lease_token=$1,lease_until=$2 WHERE id=$3 AND owner_id=$4 AND revision=$5 AND (lease_until IS NULL OR lease_until<$6)',
  );
  // The ordering CASE in the sidebar listing carries quoted status values.
  const listing = toPositional(
    "SELECT r2.id FROM agent_runs r2 WHERE r2.chat_id=? ORDER BY CASE WHEN r2.pending_status IN ('unknown','executing') THEN 0 ELSE 2 END LIMIT 1",
  );
  assert.equal(listing.includes('$1'), true);
  assert.equal(listing.includes("'unknown','executing'"), true);
  assert.equal(listing.includes('$2'), false);
});

void test('every placeholder is numbered exactly once', () => {
  const sql =
    'INSERT INTO agent_run_metrics(a,b,c,d,e,f,g,h,i,j,k,l) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)';
  const out = toPositional(sql);
  const found = [...out.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(found, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(out.includes('?'), false);
});
