import Database from 'better-sqlite3';
/**
 * The application talks D1. On Cloud Run the same SQL runs against a local
 * SQLite file, so this exposes D1's surface — prepare/bind/first/all/run and a
 * transactional batch — rather than rewriting ~25 queries and the concurrency
 * control that depends on their exact semantics.
 */
class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.db, this.sql, args);
  }
  #prepared() {
    return this.db.prepare(this.sql);
  }
  async first(column) {
    const row = this.#prepared().get(...this.args);
    if (row === undefined) return null;
    return column === undefined ? row : (row[column] ?? null);
  }
  async all() {
    const rows = this.#prepared().all(...this.args);
    return { results: rows, success: true, meta: this.#meta(0) };
  }
  async run() {
    const info = this.#prepared().run(...this.args);
    return {
      results: [],
      success: true,
      meta: this.#meta(info.changes, info.lastInsertRowid),
    };
  }
  async raw() {
    return this.#prepared().raw().all(...this.args);
  }
  #meta(changes, lastRowId = 0) {
    return {
      changes,
      last_row_id: Number(lastRowId),
      duration: 0,
      rows_read: 0,
      rows_written: changes,
      changed_db: changes > 0,
      size_after: 0,
    };
  }
  /** Executed inside batch(), where the driver call must stay synchronous. */
  runSync() {
    const statement = this.#prepared();
    if (statement.reader) {
      const rows = statement.all(...this.args);
      return { results: rows, success: true, meta: this.#meta(0) };
    }
    const info = statement.run(...this.args);
    return {
      results: [],
      success: true,
      meta: this.#meta(info.changes, info.lastInsertRowid),
    };
  }
}
export class SqliteD1 {
  constructor(file, { onWrite } = {}) {
    this.db = new Database(file);
    // WAL keeps readers off the writer's back; FULL sync so a crash cannot
    // lose an acknowledged commit, which the run checkpoints depend on.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.onWrite = onWrite;
  }
  prepare(sql) {
    return new Statement(this.db, sql);
  }
  async batch(statements) {
    // D1 applies a batch atomically; so does this.
    const apply = this.db.transaction((list) => list.map((s) => s.runSync()));
    const results = apply(statements);
    this.onWrite?.();
    return results;
  }
  async exec(sql) {
    this.db.exec(sql);
    this.onWrite?.();
    return { count: 0, duration: 0 };
  }
  async dump() {
    throw new Error('dump() is not supported by the SQLite adapter');
  }
  checkpoint() {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }
  close() {
    this.checkpoint();
    this.db.close();
  }
}
