import {
  authorize,
  failure,
  HttpError,
  json,
  readJson,
} from '@/lib/server/security';
import { loadChat } from '@/lib/server/workbench-store';
import { database } from '@/lib/server/store';
import { publication } from '@/lib/workbench/sharing';
export async function GET(request: Request) {
  try {
    const owner = await authorize(request),
      chatId = new URL(request.url).searchParams.get('chatId');
    const result = await database()
      .prepare(
        'SELECT id,created_at,revoked,uses,max_uses FROM workflow_publications WHERE owner_id=? AND chat_id=? ORDER BY created_at DESC LIMIT 20',
      )
      .bind(owner, chatId ?? '')
      .all();
    return json({ links: result.results });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const owner = await authorize(request, true),
      body = await readJson(request);
    if (typeof body.chatId !== 'string')
      throw new HttpError(400, 'Choose a workflow.');
    const chat = await loadChat(body.chatId, owner);
    if (chat.sourceShare)
      throw new HttpError(
        403,
        'Only the original owner can publish this workflow.',
      );
    if (body.revision !== chat.revision || body.reviewed !== true)
      throw new HttpError(
        409,
        'Review the current workflow instructions and rules before publishing.',
      );
    let published;
    try {
      published = await publication(chat, body.description);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const id = crypto.randomUUID();
    await database()
      .prepare(
        'INSERT INTO workflow_publications(id,owner_id,chat_id,payload,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(id, owner, chat.id, JSON.stringify(published), published.createdAt)
      .run();
    return json({ id, path: `/w/${id}`, maxUses: 10 }, 201);
  } catch (e) {
    return failure(e);
  }
}
