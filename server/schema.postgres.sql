-- Postgres schema for Cloud SQL, equivalent to drizzle/0000..0007 applied to SQLite.
--
-- Kept as one idempotent script rather than a ported migration chain: the move
-- to Postgres is a one-time copy, and replaying seven SQLite migrations in a
-- dialect they were never written for buys nothing.
--
-- Types follow what the application actually binds, not what looks tidiest.
-- SQLite stores no boolean type, so flags like use_memory, passed and revoked
-- are bound as 0/1 integers and read back with Boolean(); making them Postgres
-- booleans would break both sides of that. lease_until holds Date.now() in
-- milliseconds, which overflows a 32-bit integer, so it is bigint.

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  google_sub text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at text NOT NULL,
  expires_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, expires_at);

CREATE TABLE IF NOT EXISTS auth_throttle (
  key text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  reset_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  title text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  payload text NOT NULL,
  steps integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  lease_token text,
  lease_until bigint
);
CREATE INDEX IF NOT EXISTS idx_chats_owner_updated ON chats (owner_id, updated_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES chats(id),
  owner_id text NOT NULL,
  status text NOT NULL,
  payload text NOT NULL,
  mode text,
  error text,
  pending_status text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_chat ON agent_runs (owner_id, chat_id, created_at);
-- The sidebar picks one run per chat with this ordering on every page load.
CREATE INDEX IF NOT EXISTS idx_agent_runs_latest ON agent_runs (chat_id, owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integration_sessions (
  owner_id text PRIMARY KEY,
  session_id text NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_receipts (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  chat_id text NOT NULL,
  run_id text NOT NULL,
  state text NOT NULL,
  payload text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_receipts_chat ON tool_receipts (owner_id, chat_id);

CREATE TABLE IF NOT EXISTS tool_knowledge (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  toolkit text NOT NULL,
  slug text NOT NULL,
  kind text NOT NULL,
  claim text NOT NULL,
  detail text NOT NULL,
  status text NOT NULL,
  observations integer NOT NULL DEFAULT 1,
  successes integer NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  applied_runs integer NOT NULL DEFAULT 0,
  first_run text NOT NULL,
  last_run text NOT NULL,
  confirmed_run text,
  evidence text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_knowledge_owner_toolkit ON tool_knowledge (owner_id, toolkit, slug);
CREATE INDEX IF NOT EXISTS idx_tool_knowledge_owner_status ON tool_knowledge (owner_id, status, updated_at);

CREATE TABLE IF NOT EXISTS tool_schema_cache (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  toolkits text NOT NULL,
  payload text NOT NULL,
  created_at text NOT NULL,
  expires_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_schema_cache_owner ON tool_schema_cache (owner_id, expires_at);

CREATE TABLE IF NOT EXISTS agent_run_metrics (
  run_id text PRIMARY KEY,
  owner_id text NOT NULL,
  chat_id text NOT NULL,
  experiment_id text,
  arm integer,
  use_memory integer NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL,
  passed integer NOT NULL,
  score double precision,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  cost_usd double precision,
  duration_ms bigint NOT NULL,
  tool_calls integer NOT NULL,
  tool_errors integer NOT NULL,
  search_calls integer NOT NULL,
  search_cached integer NOT NULL,
  graph_digest text NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_run_metrics_chat ON agent_run_metrics (owner_id, chat_id, created_at);

CREATE TABLE IF NOT EXISTS workflow_publications (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  chat_id text NOT NULL,
  payload text NOT NULL,
  created_at text NOT NULL,
  revoked integer NOT NULL DEFAULT 0,
  uses integer NOT NULL DEFAULT 0,
  max_uses integer NOT NULL DEFAULT 10
);
CREATE INDEX IF NOT EXISTS idx_publications_owner_chat ON workflow_publications (owner_id, chat_id);
