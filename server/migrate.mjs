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
        if (trimmed) db.exec(trimmed);
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
