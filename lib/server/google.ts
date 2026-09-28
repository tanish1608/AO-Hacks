import { env } from 'cloudflare:workers';
import { database } from './store';
import { HttpError } from './security';
import type { AuthUser } from './auth';
import {
  decodeIdTokenPayload,
  GOOGLE_TOKEN_URL,
  verifyIdTokenClaims,
  type GoogleProfile,
} from '../workbench/google-auth';
const config = () => env as unknown as Record<string, string | undefined>;
export function googleConfigured(): boolean {
  const e = config();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}
export function googleCredentials() {
  const e = config();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET)
    throw new HttpError(503, 'Google sign-in is not configured on this server.');
  return { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET };
}
/** Exchanges the one-time code for an ID token, then validates its claims. */
export async function exchangeCode(
  code: string,
  redirectUri: string,
  nonce: string,
): Promise<GoogleProfile> {
  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await response.json().catch(() => null)) as {
    id_token?: unknown;
    error_description?: string;
    error?: string;
  } | null;
  if (!response.ok || !body?.id_token)
    // The client secret can appear in an upstream error body; never echo it.
    throw new HttpError(
      502,
      `Google sign-in failed (${body?.error ?? response.status}). Try again.`,
    );
  return verifyIdTokenClaims(decodeIdTokenPayload(body.id_token), {
    clientId,
    nonce,
  });
}
/** An account with this value can never be signed into with a password:
 *  verifyPassword rejects any scheme that is not pbkdf2. */
export const NO_PASSWORD = 'none';
/**
 * Resolves a verified Google profile to an account.
 *
 * Matching an existing account by address is only safe because
 * `verifyIdTokenClaims` requires `email_verified`; without that check this
 * would hand over any account whose address someone could claim.
 */
export async function upsertGoogleUser(
  profile: GoogleProfile,
): Promise<AuthUser> {
  const at = new Date().toISOString();
  const bySub = await database()
    .prepare('SELECT id,email,name FROM users WHERE google_sub=?')
    .bind(profile.sub)
    .first<{ id: string; email: string; name: string }>();
  if (bySub) return bySub;
  const byEmail = await database()
    .prepare('SELECT id,email,name,google_sub FROM users WHERE email=?')
    .bind(profile.email)
    .first<{ id: string; email: string; name: string; google_sub: string | null }>();
  if (byEmail) {
    if (byEmail.google_sub && byEmail.google_sub !== profile.sub)
      throw new HttpError(
        409,
        'This email is already linked to a different Google account.',
      );
    const linked = await database()
      .prepare(
        'UPDATE users SET google_sub=?,updated_at=? WHERE id=? AND (google_sub IS NULL OR google_sub=?)',
      )
      .bind(profile.sub, at, byEmail.id, profile.sub)
      .run();
    if (!linked.meta.changes)
      throw new HttpError(409, 'Could not link this Google account. Try again.');
    return { id: byEmail.id, email: byEmail.email, name: byEmail.name };
  }
  const id = crypto.randomUUID();
  const created = await database()
    .prepare(
      'INSERT INTO users(id,email,name,password_hash,google_sub,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM users WHERE email=? OR google_sub=?)',
    )
    .bind(id, profile.email, profile.name, NO_PASSWORD, profile.sub, at, at, profile.email, profile.sub)
    .run();
  // Lost a race with a simultaneous sign-in for the same account: read the
  // winner rather than reporting a failure the person cannot act on.
  if (!created.meta.changes) {
    const existing = await database()
      .prepare('SELECT id,email,name FROM users WHERE google_sub=? OR email=?')
      .bind(profile.sub, profile.email)
      .first<{ id: string; email: string; name: string }>();
    if (!existing) throw new HttpError(409, 'Could not create this account. Try again.');
    return existing;
  }
  return { id, email: profile.email, name: profile.name };
}
