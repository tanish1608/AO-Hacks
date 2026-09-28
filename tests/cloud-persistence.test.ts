import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteD1 } from '../server/d1-sqlite.mjs';
import { snapshotBytes } from '../server/persistence.mjs';
void test('standalone writes trigger snapshots and online backup includes uncheckpointed WAL commits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'foundry-durability-'));
  let writes = 0;
  const file = join(dir, 'source.sqlite');
  const source = new SqliteD1(file, { onWrite: () => writes++ });
  try {
    await source.exec(
      'CREATE TABLE entries(id INTEGER PRIMARY KEY,value TEXT)',
    );
    source.db.pragma('wal_autocheckpoint = 0');
    writes = 0;
    await source
      .prepare('INSERT INTO entries(value) VALUES(?)')
      .bind('retained')
      .run();
    assert.equal(writes, 1);
    const backup = join(dir, 'restored.sqlite');
    await writeFile(backup, await snapshotBytes(source, file));
    const restored = new SqliteD1(backup);
    try {
      assert.equal(
        await restored.prepare('SELECT value FROM entries').first('value'),
        'retained',
      );
      assert.equal(
        restored.db.pragma('integrity_check', { simple: true }),
        'ok',
      );
    } finally {
      restored.close();
    }
  } finally {
    source.close();
    await rm(dir, { recursive: true, force: true });
  }
});
