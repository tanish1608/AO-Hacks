import pg from 'pg';

/**
 * The application talks D1. This serves the same surface —
 * prepare/bind/first/all/run and a transactional batch — from Cloud SQL, so the
 * queries and the lease/revision concurrency control stay exactly as written.
 *
 * Postgres is what makes more than one instance possible: the SQLite adapter
 * keeps the database in the container's filesystem, so two instances would each
 * hold their own copy and the last snapshot would silently win.
 *
 * Two differences from SQLite are handled here rather than in the app:
 * placeholders (`?` versus `$1`), and the fact that a Postgres pool hands out a
 * different connection per query — so a batch has to pin one client for its
 * transaction, or the statements would not share it.
 */
const { Pool, types } = pg;

// Return NUMERIC as a JS number. Only cost_usd and score use it, both small
// enough to be exact, and the app's types expect numbers rather than strings.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// int8 likewise: COUNT() and our integer columns are far inside the safe range.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

/** `?` is positional in SQLite and a nonsense operator in Postgres. Rewrite,
 *  taking care not to touch a `?` inside a quoted string literal. */
export function toPositional(sql) {
  let out = '';
  let index = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      out += c;
      if (c === quote) {
        // A doubled quote is an escaped quote, so the literal continues.
        if (sql[i + 1] === quote) out += sql[++i];
        else quote = null;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      out += c;
      continue;
    }
    out += c === '?' ? `$${++index}` : c;
  }
  return out;
}

class Statement {
  constructor(pool, sql, args = [], client = null) {
    this.pool = pool;
    this.sql = sql;
    this.args = args;
    this.client = client;
  }
  bind(...args) {
    return new Statement(this.pool, this.sql, args, this.client);
  }
  async #query() {
    const runner = this.client ?? this.pool;
    return runner.query(toPositional(this.sql), this.args);
  }
  async first(column) {
    const { rows } = await this.#query();
    if (!rows.length) return null;
    return column === undefined ? rows[0] : (rows[0][column] ?? null);
  }
  async all() {
    const result = await this.#query();
    return { results: result.rows, success: true, meta: meta(result) };
  }
  async run() {
    const result = await this.#query();
    return { results: [], success: true, meta: meta(result) };
  }
  async raw() {
    const { rows } = await this.#query();
    return rows.map((r) => Object.values(r));
  }
  /** Used inside batch(), bound to the transaction's own client. */
  on(client) {
    return new Statement(this.pool, this.sql, this.args, client);
  }
}
function meta(result) {
  const changes = result.rowCount ?? 0;
  return {
    changes,
    last_row_id: 0,
    duration: 0,
    rows_read: result.rows?.length ?? 0,
    rows_written: changes,
    changed_db: changes > 0,
    size_after: 0,
  };
}
export class PostgresD1 {
  constructor(config) {
    this.pool = new Pool(config);
    // A pool error on an idle client would otherwise reach the process as an
    // unhandled rejection and take the server down.
    this.pool.on('error', (error) => console.error('postgres pool error', error));
  }
  prepare(sql) {
    return new Statement(this.pool, sql);
  }
  async batch(statements) {
    // D1 applies a batch atomically; so does this. Every statement runs on one
    // pinned client, which is what makes it a single transaction.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results = [];
      for (const s of statements) results.push(await s.on(client).run());
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  async exec(sql) {
    await this.pool.query(sql);
    return { count: 0, duration: 0 };
  }
  async dump() {
    throw new Error('dump() is not supported by the Postgres adapter');
  }
  async close() {
    await this.pool.end();
  }
}
