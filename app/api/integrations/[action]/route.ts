import {
  authorize,
  failure,
  HttpError,
  json,
  readJson,
} from '@/lib/server/security';
import { gateway, integrationSession } from '@/lib/server/workbench-provider';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const owner = await authorize(request, true),
      b = await readJson(request);
    if ((await params).action !== 'connect')
      throw new HttpError(404, 'Unknown integration action');
    if (typeof b.toolkit !== 'string' || !/^[a-z0-9_]{1,60}$/.test(b.toolkit))
      throw new HttpError(400, 'Enter a valid Composio toolkit slug');
    const returnTo = new URL('/?settings=connections', request.url);
    if (typeof b.chatId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(b.chatId))
      returnTo.searchParams.set('task', b.chatId);
    const result = await gateway().authorize(
      await integrationSession(owner),
      b.toolkit,
      returnTo.href,
    );
    const url = new URL(result.redirect_url);
    if (url.protocol !== 'https:')
      throw new HttpError(502, 'Authorization service returned an invalid URL');
    return json({ url: url.href });
  } catch (e) {
    const error =
      e instanceof HttpError
        ? e
        : new HttpError(
            502,
            e instanceof Error ? e.message : 'Connection failed',
          );
    return failure(error);
  }
}
