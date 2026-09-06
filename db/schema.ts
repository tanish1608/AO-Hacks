import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
export const experiments = sqliteTable(
  'experiments',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    revision: integer('revision').notNull().default(0),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    leaseToken: text('lease_token'),
    leaseUntil: integer('lease_until'),
  },
  (t) => [index('idx_experiments_owner_created').on(t.ownerId, t.createdAt)],
);
export const releases = sqliteTable(
  'releases',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => experiments.id),
    architectureDigest: text('architecture_digest').notNull(),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_releases_owner_created').on(t.ownerId, t.createdAt),
    uniqueIndex('idx_releases_owner_experiment').on(t.ownerId, t.experimentId),
  ],
);
export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
    revision: integer('revision').notNull().default(0),
    payload: text('payload').notNull(),
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
