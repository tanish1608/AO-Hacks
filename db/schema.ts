import {
  sqliteTable,
  text,
  integer,
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
