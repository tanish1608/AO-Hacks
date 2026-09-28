import { failure, HttpError, json, readJson } from '@/lib/server/security';
import {
  authenticate,
  clearedCookie,
  clearFailures,
  createSession,
  createUser,
  destroySession,
  pruneAuth,
  recordFailure,
  sessionCookie,
  SESSION_COOKIE,
  throttleGuard,
} from '@/lib/server/auth';
import { currentUser } from '@/app/auth';
import {
  safeNextPath,
  validateLogin,
  validateSignup,
} from '@/lib/workbench/credentials';
import { cookies } from 'next/headers';
/** A cookie without Secure would be sent over plain HTTP; a Secure cookie on
 *  http://127.0.0.1 would never be stored. Follow the scheme actually in use. */
function isSecure(request: Request) {
  const url = new URL(request.url);
  return (
    request.headers.get('x-forwarded-proto') === 'https' || url.protocol === 'https:'
  );
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const action = (await params).action;
    if (!['signup', 'login', 'logout'].includes(action))
      throw new HttpError(404, 'Unknown action');
    // Same cross-origin and content-type guards the workspace routes use; the
    // session cookie is SameSite=Lax, so a cross-site POST carries no identity.
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
      throw new HttpError(403, 'Cross-origin requests are not allowed');
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (action === 'logout') {
      await destroySession(token);
      return json({ ok: true }, 200, { 'Set-Cookie': clearedCookie(isSecure(request)) });
    }
    if (!request.headers.get('content-type')?.includes('application/json'))
      throw new HttpError(415, 'Use application/json');
    const body = await readJson(request);
    const next = safeNextPath(body.next);
    await pruneAuth().catch(() => {});
    if (action === 'signup') {
      let input;
      try {
        input = validateSignup(body);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      const user = await createUser(input.email, input.name, input.password);
      return json({ next, email: user.email }, 201, {
        'Set-Cookie': sessionCookie(await createSession(user.id), isSecure(request)),
      });
    }
    let input;
    try {
      input = validateLogin(body);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const key = `login:${input.email}`;
    await throttleGuard(key);
    const user = await authenticate(input.email, input.password);
    if (!user) {
      await recordFailure(key).catch(() => {});
      // One message for both causes: saying which was wrong tells an attacker
      // whether the address has an account here.
      throw new HttpError(401, 'That email and password do not match an account.');
    }
    await clearFailures(key).catch(() => {});
    return json({ next, email: user.email }, 200, {
      'Set-Cookie': sessionCookie(await createSession(user.id), isSecure(request)),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function GET() {
  try {
    const user = await currentUser();
    return json({ user: user ? { email: user.email, name: user.name } : null });
  } catch (e) {
    return failure(e);
  }
}
