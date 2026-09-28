import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, sessionUser, type AuthUser } from '@/lib/server/auth';
import { safeNextPath } from '@/lib/workbench/credentials';
export type { AuthUser };
/** The signed-in account, or null. Identity comes only from the session
 *  cookie: no request header is ever trusted to say who is calling. */
export async function currentUser(): Promise<AuthUser | null> {
  return sessionUser((await cookies()).get(SESSION_COOKIE)?.value);
}
export async function requireUser(next: string): Promise<AuthUser> {
  const user = await currentUser();
  if (user) return user;
  redirect(signInPath(next));
}
export function signInPath(next: string): string {
  const target = safeNextPath(next);
  return target === '/app' ? '/login' : `/login?next=${encodeURIComponent(target)}`;
}
