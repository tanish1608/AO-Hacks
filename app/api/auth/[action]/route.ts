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
  exchangeCode,
  googleCredentials,
  upsertGoogleUser,
} from '@/lib/server/google';
import {
  authorizeUrl,
  packState,
  unpackState,
} from '@/lib/workbench/google-auth';
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
const STATE_COOKIE = 'foundry_oauth';
function stateCookie(value: string, secure: boolean, maxAge = 600) {
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
/** Google redirects back with a top-level GET, so both legs live on GET. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const action = (await params).action;
    if (action === 'session') {
      const user = await currentUser();
      return json({ user: user ? { email: user.email, name: user.name } : null });
    }
    if (action !== 'google') throw new HttpError(404, 'Unknown action');
    const url = new URL(request.url);
    const secure = isSecure(request);
    // Google is told to come back to this exact path, so it must be rebuilt
    // identically here or the token exchange is rejected.
    const redirectUri = `${url.origin}/api/auth/google`;
    const store = await cookies();
    if (!url.searchParams.get('code')) {
      if (url.searchParams.get('error'))
        return Response.redirect(`${url.origin}/login?error=google`, 303);
      const { clientId } = googleCredentials();
      const nonce = crypto.randomUUID();
      const next = safeNextPath(url.searchParams.get('next'));
      return new Response(null, {
        status: 303,
        headers: {
          Location: authorizeUrl({
            clientId,
            redirectUri,
            state: packState(nonce, next),
            nonce,
          }),
          // The state travels in a cookie as well as the URL; a callback that
          // did not start here cannot produce a matching pair.
          'Set-Cookie': stateCookie(packState(nonce, next), secure),
          'Cache-Control': 'no-store',
        },
      });
    }
    const saved = unpackState(store.get(STATE_COOKIE)?.value);
    const returned = unpackState(url.searchParams.get('state'));
    const clear = stateCookie('', secure, 0);
    if (!saved || !returned || saved.nonce !== returned.nonce)
      return new Response(null, {
        status: 303,
        headers: { Location: `${url.origin}/login?error=state`, 'Set-Cookie': clear },
      });
    const profile = await exchangeCode(
      url.searchParams.get('code')!,
      redirectUri,
      saved.nonce,
    );
    const user = await upsertGoogleUser(profile);
    await pruneAuth().catch(() => {});
    const token = await createSession(user.id);
    const headers = new Headers({
      Location: `${url.origin}${safeNextPath(saved.next)}`,
      'Cache-Control': 'no-store',
    });
    headers.append('Set-Cookie', sessionCookie(token, secure));
    headers.append('Set-Cookie', clear);
    return new Response(null, { status: 303, headers });
  } catch (e) {
    // A failed sign-in should land on the sign-in page, not on raw JSON.
    const url = new URL(request.url);
    const message = e instanceof HttpError ? e.message : 'Google sign-in failed. Try again.';
    return new Response(null, {
      status: 303,
      headers: {
        Location: `${url.origin}/login?error=${encodeURIComponent(message.slice(0, 160))}`,
        'Cache-Control': 'no-store',
      },
    });
  }
}
