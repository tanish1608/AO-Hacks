import { database } from './store';
import { HttpError } from './security';
import {
  decoyHash,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from '../workbench/password';
export { hashPassword, verifyPassword };
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}
export const SESSION_COOKIE = 'foundry_session';
const SESSION_DAYS = 30;
const THROTTLE_FAILURES = 10;
const THROTTLE_MINUTES = 15;
/**
 * Repeated password guesses against one address are slowed down here rather
 * than at the edge, because the account is what is being attacked. A success
 * clears the counter, so someone who simply mistyped is not locked out.
 */
export async function throttleGuard(key: string) {
  const row = await database()
    .prepare('SELECT failures,reset_at FROM auth_throttle WHERE key=?')
    .bind(key)
    .first<{ failures: number; reset_at: string }>();
  if (!row || row.reset_at < new Date().toISOString()) return;
  if (row.failures >= THROTTLE_FAILURES)
    throw new HttpError(
      429,
      'Too many sign-in attempts. Wait a few minutes and try again.',
    );
}
export async function recordFailure(key: string) {
  const reset = new Date(Date.now() + THROTTLE_MINUTES * 60_000).toISOString();
  await database()
    .prepare(
      'INSERT INTO auth_throttle(key,failures,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN auth_throttle.reset_at<? THEN 1 ELSE auth_throttle.failures+1 END,reset_at=?',
    )
    .bind(key, reset, new Date().toISOString(), reset)
    .run();
}
export async function clearFailures(key: string) {
  await database().prepare('DELETE FROM auth_throttle WHERE key=?').bind(key).run();
}
export async function createUser(
  email: string,
  name: string,
  password: string,
): Promise<AuthUser> {
  const id = crypto.randomUUID(),
    at = new Date().toISOString();
  // Guarded insert rather than a read-then-write: two simultaneous sign-ups
  // for one address must not both believe they created the account.
  const result = await database()
    .prepare(
      'INSERT INTO users(id,email,name,password_hash,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM users WHERE email=?)',
    )
    .bind(id, email, name, await hashPassword(password), at, at, email)
    .run();
  if (!result.meta.changes)
    throw new HttpError(409, 'An account with this email already exists.');
  return { id, email, name };
}
export async function authenticate(
  email: string,
  password: string,
): Promise<AuthUser | null> {
  const row = await database()
    .prepare('SELECT id,email,name,password_hash FROM users WHERE email=?')
    .bind(email)
    .first<{ id: string; email: string; name: string; password_hash: string }>();
  // Hash against a decoy when the address is unknown, so an account that does
  // not exist and a wrong password take the same time and cannot be told apart.
  const ok = await verifyPassword(password, row?.password_hash ?? decoyHash());
  return row && ok ? { id: row.id, email: row.email, name: row.name } : null;
}
export async function createSession(userId: string): Promise<string> {
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const at = new Date();
  // Only the hash is stored: a leaked database row cannot be replayed as a
  // cookie, for the same reason passwords are not kept in the clear.
  await database()
    .prepare('INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)')
    .bind(
      await sha256Hex(token),
      userId,
      at.toISOString(),
      new Date(at.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
    )
    .run();
  return token;
}
export async function sessionUser(
  token: string | undefined,
): Promise<AuthUser | null> {
  if (!token || token.length > 200) return null;
  const row = await database()
    .prepare(
      'SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?',
    )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<{ id: string; email: string; name: string }>();
  return row ?? null;
}
export async function destroySession(token: string | undefined) {
  if (!token) return;
  await database()
    .prepare('DELETE FROM sessions WHERE id=?')
    .bind(await sha256Hex(token))
    .run();
}
/** Clears expired sessions and stale throttle rows; cheap enough to run on sign-in. */
export async function pruneAuth() {
  const now = new Date().toISOString();
  await database().batch([
    database().prepare('DELETE FROM sessions WHERE expires_at<?').bind(now),
    database().prepare('DELETE FROM auth_throttle WHERE reset_at<?').bind(now),
  ]);
}
export function sessionCookie(token: string, secure: boolean): string {
  // Lax, not Strict: a shared workflow link opened from email is a top-level
  // GET and must arrive signed in, while cross-site POSTs still carry no cookie.
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? '; Secure' : ''}`;
}
export function clearedCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
