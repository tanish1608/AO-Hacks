import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Applies the drizzle migrations to a fresh SQLite file. Cloud Run has no
 * `wrangler d1 migrations apply`, and an empty database would otherwise fail
 * every query on a new instance.
 */
export function migrate(db, dir) {
  if (!existsSync(dir)) return [];
  db.exec(
    'CREATE TABLE IF NOT EXISTS _migrations(tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  // Local D1 databases already record applied migrations in Cloudflare's
  // `d1_migrations` table. Cloud Run uses this adapter instead of Wrangler;
  // import that history before attempting to replay CREATE TABLE statements.
  const hasD1History = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'",
    )
    .get();
  if (hasD1History) {
    const existing = db
      .prepare('SELECT COUNT(*) AS count FROM _migrations')
      .get().count;
    if (!existing) {
      const rows = db
        .prepare('SELECT name, applied_at FROM d1_migrations')
        .all();
      const insert = db.prepare(
        'INSERT OR IGNORE INTO _migrations(tag, applied_at) VALUES(?, ?)',
      );
      const bootstrap = db.transaction(() => {
        for (const row of rows) insert.run(row.name, row.applied_at);
      });
      bootstrap();
    }
  }
  const done = new Set(
    db.prepare('SELECT tag FROM _migrations').all().map((r) => r.tag),
  );
  const applied = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const tag = file.replace(/\.sql$/, '');
    if (done.has(tag)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    const run = db.transaction(() => {
      for (const statement of sql.split('--> statement-breakpoint')) {
        const trimmed = statement.trim();
        if (!trimmed) continue;
        try {
          db.exec(trimmed);
        } catch (error) {
          // A database restored from Wrangler's D1 directory may contain the
          // schema but not the adapter's bookkeeping table. Treat idempotent
          // CREATE statements as already applied, while preserving every
          // other migration error.
          if (!/already exists/i.test(String(error))) throw error;
        }
      }
      db.prepare('INSERT INTO _migrations(tag, applied_at) VALUES(?, ?)').run(
        tag,
        new Date().toISOString(),
      );
    });
    run();
    applied.push(tag);
  }
  return applied;
}
