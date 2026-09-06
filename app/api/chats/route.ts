import {validateAppSelection} from '@/lib/workbench/apps';
import {
  authorize,
  failure,
  HttpError,
  json,
  readJson,
} from '@/lib/server/security';
import { createChat, design } from '@/lib/workbench/engine';
import { dependencies } from '@/lib/server/workbench-provider';
import { insertChat, listChats, snapshot } from '@/lib/server/workbench-store';
export async function GET(request: Request) {
  try {
    return json({ chats: await listChats(await authorize(request)) });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const owner = await authorize(request, true);
    const body = await readJson(request);
    if (
      typeof body.message !== 'string' ||
      !body.message.trim() ||
      body.message.length > 12000
    )
      throw new HttpError(400, 'Describe your task in 1–12,000 characters.');
    const chat = createChat(crypto.randomUUID());
    chat.selectedApps=validateAppSelection(body.selectedApps);
    const deps = await dependencies(owner, chat);
    const result = await design(chat, body.message, deps, chat.selectedApps??[]);
    await insertChat(result, owner);
    return json(await snapshot(result, owner), 201);
  } catch (e) {
    const error =
      e instanceof HttpError
        ? e
        : new HttpError(
            502,
            e instanceof Error ? e.message : 'Architecture generation failed',
          );
    return failure(error);
  }
}
