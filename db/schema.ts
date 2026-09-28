import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    // pbkdf2$<iterations>$<salt>$<hash>, all base64. Never a bare digest.
    // Holds the literal 'none' for an account that signs in with Google only:
    // verifyPassword rejects any value whose scheme is not pbkdf2, so a
    // password can never be guessed into one of those accounts.
    passwordHash: text('password_hash').notNull(),
    // Google's stable subject claim. Null until an account links Google.
    googleSub: text('google_sub'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_users_email').on(t.email),
    uniqueIndex('idx_users_google_sub').on(t.googleSub),
  ],
);
export const sessions = sqliteTable(
  'sessions',
  {
    // SHA-256 of the cookie token. A stolen database row cannot be replayed
    // as a cookie, the same reason passwords are not stored in the clear.
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('idx_sessions_user').on(t.userId, t.expiresAt)],
);
export const authThrottle = sqliteTable('auth_throttle', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull().default(0),
  resetAt: text('reset_at').notNull(),
});
export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
    revision: integer('revision').notNull().default(0),
    payload: text('payload').notNull(),
    // Derived from payload on write. The sidebar listing used SQLite JSON
    // functions to read these without downloading every payload; a real column
    // is faster and, unlike json_extract, is the same SQL on any engine.
    steps: integer('steps').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    leaseToken: text('lease_token'),
    leaseUntil: integer('lease_until'),
  },
  (t) => [index('idx_chats_owner_updated').on(t.ownerId, t.updatedAt)],
);
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id),
    ownerId: text('owner_id').notNull(),
    status: text('status').notNull(),
    payload: text('payload').notNull(),
    // Also derived on write, for the same reason.
    mode: text('mode'),
    error: text('error'),
    pendingStatus: text('pending_status'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('idx_agent_runs_chat').on(t.ownerId, t.chatId, t.createdAt)],
);
export const integrationSessions = sqliteTable('integration_sessions', {
  ownerId: text('owner_id').primaryKey(),
  sessionId: text('session_id').notNull(),
  createdAt: text('created_at').notNull(),
});
export const toolReceipts = sqliteTable(
  'tool_receipts',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    chatId: text('chat_id').notNull(),
    runId: text('run_id').notNull(),
    state: text('state').notNull(),
    payload: text('payload'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_tool_receipts_chat').on(t.ownerId, t.chatId)],
);
export const toolKnowledge = sqliteTable(
  'tool_knowledge',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    toolkit: text('toolkit').notNull(),
    slug: text('slug').notNull(),
    kind: text('kind').notNull(),
    claim: text('claim').notNull(),
    detail: text('detail').notNull(),
    status: text('status').notNull(),
    observations: integer('observations').notNull().default(1),
    successes: integer('successes').notNull().default(0),
    failures: integer('failures').notNull().default(0),
    appliedRuns: integer('applied_runs').notNull().default(0),
    firstRun: text('first_run').notNull(),
    lastRun: text('last_run').notNull(),
    confirmedRun: text('confirmed_run'),
    evidence: text('evidence').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('idx_tool_knowledge_owner_toolkit').on(t.ownerId, t.toolkit, t.slug),
    index('idx_tool_knowledge_owner_status').on(
      t.ownerId,
      t.status,
      t.updatedAt,
    ),
  ],
);
export const toolSchemaCache = sqliteTable(
  'tool_schema_cache',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    toolkits: text('toolkits').notNull(),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('idx_tool_schema_cache_owner').on(t.ownerId, t.expiresAt)],
);
export const agentRunMetrics = sqliteTable(
  'agent_run_metrics',
  {
    runId: text('run_id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    chatId: text('chat_id').notNull(),
    experimentId: text('experiment_id'),
    arm: integer('arm'),
    useMemory: integer('use_memory').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull(),
    passed: integer('passed').notNull(),
    score: real('score'),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costUsd: real('cost_usd'),
    durationMs: integer('duration_ms').notNull(),
    toolCalls: integer('tool_calls').notNull(),
    toolErrors: integer('tool_errors').notNull(),
    searchCalls: integer('search_calls').notNull(),
    searchCached: integer('search_cached').notNull(),
    graphDigest: text('graph_digest').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_agent_run_metrics_chat').on(t.ownerId, t.chatId, t.createdAt),
  ],
);

export const workflowPublications = sqliteTable('workflow_publications', {
  id:text('id').primaryKey(), ownerId:text('owner_id').notNull(), chatId:text('chat_id').notNull(),
  payload:text('payload').notNull(), createdAt:text('created_at').notNull(), revoked:integer('revoked').notNull().default(0),
  uses:integer('uses').notNull().default(0), maxUses:integer('max_uses').notNull().default(10),
}, t=>[index('idx_publications_owner_chat').on(t.ownerId,t.chatId)]);
