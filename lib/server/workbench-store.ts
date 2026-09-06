import type { Chat, Run } from '../workbench/types';
import { database } from './store';
import { HttpError } from './security';
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
export async function snapshot(chat: Chat, owner: string) {
  return { chat: publicChat(chat), runs: await listRuns(chat.id, owner) };
}
