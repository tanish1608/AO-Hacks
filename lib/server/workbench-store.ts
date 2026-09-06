import type { Chat, Run, RunMetric } from '../workbench/types';
import { runMetrics } from '../workbench/metrics';
import { needsZohoDraftDelivery } from '../workbench/zoho-tools';
import { listKnowledge } from './tool-knowledge-store';
import { database } from './store';
import { HttpError } from './security';
const TERMINAL = ['completed', 'exhausted', 'blocked', 'failed'];
/**
 * Compact per-run projection. Run payloads carry full traces and are capped at
 * 30 rows, which is too short a window for a learning trend, so the numbers are
 * kept separately.
 */
export async function listRunMetrics(
  chatId: string,
  owner: string,
  limit = 200,
): Promise<RunMetric[]> {
  const rows = await database()
    .prepare(
      "SELECT run_id,chat_id,experiment_id,arm,use_memory,status,attempts,passed,score,input_tokens,output_tokens,cost_usd,duration_ms,tool_calls,tool_errors,search_calls,search_cached,graph_digest,created_at FROM agent_run_metrics AS m WHERE chat_id=? AND owner_id=? AND NOT EXISTS (SELECT 1 FROM agent_runs AS r WHERE r.id=m.run_id AND r.owner_id=m.owner_id AND json_extract(r.payload,'$.mode')='manual') ORDER BY created_at ASC LIMIT ?",
    )
    .bind(chatId, owner, limit)
    .all<Record<string, string | number | null>>();
  return rows.results.map((r) => ({
    runId: String(r.run_id),
    chatId: String(r.chat_id),
    experimentId: r.experiment_id === null ? null : String(r.experiment_id),
    arm: r.arm === null ? null : Number(r.arm),
    useMemory: Boolean(r.use_memory),
    status: String(r.status) as RunMetric['status'],
    attempts: Number(r.attempts),
    passed: Boolean(r.passed),
    score: r.score === null ? null : Number(r.score),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    // Null means pricing was unknown for that run, never that it was free.
    costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    durationMs: Number(r.duration_ms),
    toolCalls: Number(r.tool_calls),
    toolErrors: Number(r.tool_errors),
    searchCalls: Number(r.search_calls),
    searchCached: Number(r.search_cached),
    graphDigest: String(r.graph_digest),
    createdAt: String(r.created_at),
  }));
}
export async function listChats(owner: string) {
  return (
    await database()
      .prepare(
        'SELECT id,title,updated_at FROM chats WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100',
      )
      .bind(owner)
      .all()
  ).results;
}
export async function loadChat(id: string, owner: string): Promise<Chat> {
  const row = await database()
    .prepare('SELECT payload FROM chats WHERE id=? AND owner_id=?')
    .bind(id, owner)
    .first<{ payload: string }>();
  if (!row) throw new HttpError(404, 'Chat not found');
  return JSON.parse(row.payload);
}
export async function insertChat(chat: Chat, owner: string) {
  await database()
    .prepare(
      'INSERT INTO chats(id,owner_id,title,revision,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    )
    .bind(
      chat.id,
      owner,
      chat.title,
      chat.revision,
      JSON.stringify(chat),
      chat.createdAt,
      chat.updatedAt,
    )
    .run();
}
export async function listRuns(chatId: string, owner: string): Promise<Run[]> {
  const rows = await database()
    .prepare(
      'SELECT payload FROM agent_runs WHERE chat_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 30',
    )
    .bind(chatId, owner)
    .all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload));
}
export async function leaseChat(chat: Chat, owner: string) {
  const token = crypto.randomUUID(),
    at = Date.now();
  const result = await database()
    .prepare(
      'UPDATE chats SET lease_token=?,lease_until=? WHERE id=? AND owner_id=? AND revision=? AND (lease_until IS NULL OR lease_until<?)',
    )
    .bind(token, at + 180000, chat.id, owner, chat.revision, at)
    .run();
  if (!result.meta.changes)
    throw new HttpError(
      409,
      'A step is in progress or this chat changed. Refresh and try again.',
    );
  return token;
}
export async function releaseChat(id: string, owner: string, token: string) {
  await database()
    .prepare(
      'UPDATE chats SET lease_token=NULL,lease_until=NULL WHERE id=? AND owner_id=? AND lease_token=?',
    )
    .bind(id, owner, token)
    .run();
}
export async function saveChat(
  chat: Chat,
  owner: string,
  token: string,
  run?: Run,
  keepLease = false,
) {
  const previous = chat.revision;
  chat.revision++;
  chat.updatedAt = new Date().toISOString();
  if (run) {
    run.revision++;
    run.updatedAt = chat.updatedAt;
  }
  const statement = database()
    .prepare(
      `UPDATE chats SET title=?,revision=?,payload=?,updated_at=?,lease_token=?,lease_until=? WHERE id=? AND owner_id=? AND lease_token=? AND revision=? AND lease_until>?`,
    )
    .bind(
      chat.title,
      chat.revision,
      JSON.stringify(chat),
      chat.updatedAt,
      keepLease ? token : null,
      keepLease ? Date.now() + 180000 : null,
      chat.id,
      owner,
      token,
      previous,
      Date.now(),
    );
  // Run insert depends on the matching chat revision/token, within the same D1 transaction.
  const queries = [statement];
  if (run)
    queries.push(
      database()
        .prepare(
          `INSERT INTO agent_runs(id,chat_id,owner_id,status,payload,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chats WHERE id=? AND owner_id=? AND revision=? AND payload=?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at`,
        )
        .bind(
          run.id,
          chat.id,
          owner,
          run.status,
          JSON.stringify(run),
          run.createdAt,
          run.updatedAt,
          chat.id,
          owner,
          chat.revision,
          JSON.stringify(chat),
        ),
    );
  // Derived chat/run state, so it belongs in the same guarded batch as the run.
  if (run && run.mode !== 'manual' && TERMINAL.includes(run.status)) {
    const m = runMetrics(run);
    queries.push(
      database()
        .prepare(
          'INSERT INTO agent_run_metrics(run_id,owner_id,chat_id,experiment_id,arm,use_memory,status,attempts,passed,score,input_tokens,output_tokens,cost_usd,duration_ms,tool_calls,tool_errors,search_calls,search_cached,graph_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status,attempts=excluded.attempts,passed=excluded.passed,score=excluded.score,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,cost_usd=excluded.cost_usd,duration_ms=excluded.duration_ms,tool_calls=excluded.tool_calls,tool_errors=excluded.tool_errors,search_calls=excluded.search_calls,search_cached=excluded.search_cached',
        )
        .bind(
          m.runId,
          owner,
          m.chatId,
          m.experimentId,
          m.arm,
          m.useMemory ? 1 : 0,
          m.status,
          m.attempts,
          m.passed ? 1 : 0,
          m.score,
          m.inputTokens,
          m.outputTokens,
          m.costUsd,
          m.durationMs,
          m.toolCalls,
          m.toolErrors,
          m.searchCalls,
          m.searchCached,
          m.graphDigest,
          m.createdAt,
        ),
    );
  }
  const result = await database().batch(queries);
  if (!result[0].meta.changes)
    throw new HttpError(
      409,
      'Chat checkpoint changed; this result was not saved',
    );
}
export function publicChat(chat: Chat) {
  const { sessionId: _sessionId, ...safe } = chat;
  return safe;
}
/** Toolkits this task could plausibly use, for the learning view's rule list. */
function chatToolkits(chat: Chat) {
  return [
    ...new Set([
      ...(chat.selectedApps ?? []),
      ...chat.versions.flatMap((v) => v.workflow.nodes.flatMap((n) => n.toolkits)),
    ]),
  ];
}
export async function snapshot(chat: Chat, owner: string) {
  const [runs, metrics, knowledge] = await Promise.all([
    listRuns(chat.id, owner),
    listRunMetrics(chat.id, owner).catch(() => []),
    listKnowledge(owner, chatToolkits(chat)).catch(() => []),
  ]);
  const correctedMetrics = metrics.map(metric => {
    const run = runs.find(r => r.id === metric.runId);
    const attempt = run?.attempts.at(-1);
    if (!run || !attempt || !needsZohoDraftDelivery(attempt)) return metric;
    const current = runMetrics(run);
    return { ...metric, score: current.score, passed: current.passed };
  });
  return { chat: publicChat(chat), runs, metrics: correctedMetrics, knowledge };
}
