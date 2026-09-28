import { database } from './store';
import { HttpError } from './security';
import {
  instantiatePublished,
  type PublishedWorkflow,
} from '../workbench/sharing';
export async function loadPublication(id: string) {
  const row = await database()
    .prepare(
      'SELECT id,owner_id,payload,revoked,uses,max_uses FROM workflow_publications WHERE id=?',
    )
    .bind(id)
    .first<{
      id: string;
      owner_id: string;
      payload: string;
      revoked: number;
      uses: number;
      max_uses: number;
    }>();
  if (!row || row.revoked)
    throw new HttpError(404, 'This workflow link is unavailable.');
  return { ...row, publication: JSON.parse(row.payload) as PublishedWorkflow };
}
export async function assertShareActive(id: string) {
  await loadPublication(id);
}
export async function createPublishedSession(id: string, owner: string) {
  const row = await loadPublication(id),
    chat = await instantiatePublished(id, row.publication);
  // D1 batch is transactional: reserve an entire session atomically, before any model spend.
  const result = await database().batch([
    database()
      .prepare(
        'INSERT INTO chats(id,owner_id,title,revision,payload,created_at,updated_at) SELECT ?,?,?,?,?,?,? FROM workflow_publications WHERE id=? AND revoked=0 AND uses<max_uses',
      )
      .bind(
        chat.id,
        owner,
        chat.title,
        chat.revision,
        JSON.stringify(chat),
        chat.createdAt,
        chat.updatedAt,
        id,
      ),
    database()
      .prepare(
        'UPDATE workflow_publications SET uses=uses+1 WHERE id=? AND EXISTS(SELECT 1 FROM chats WHERE id=? AND owner_id=?)',
      )
      .bind(id, chat.id, owner),
  ]);
  if (!result[0].meta.changes)
    throw new HttpError(
      409,
      'This link has reached its run limit or was disabled. Ask the owner for a new link.',
    );
  return chat;
}
