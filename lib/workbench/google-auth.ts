/**
 * Google sign-in, the parts that are pure decisions rather than I/O.
 *
 * The token exchange happens in `lib/server/google.ts`; everything that decides
 * whether to trust a response lives here so it can be tested directly.
 */
import { normalizeEmail, normalizeName } from './credentials.ts';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const CLOCK_SKEW_SECONDS = 120;
export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}
export interface IdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  nonce?: unknown;
  exp?: unknown;
  iat?: unknown;
}
export function authorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', options.state);
  url.searchParams.set('nonce', options.nonce);
  // Ask for the account chooser rather than silently reusing whichever Google
  // account the browser happens to be signed into.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}
/**
 * Validates the claims of an ID token that came straight from Google's token
 * endpoint over TLS, which is why the signature is not re-checked here: the
 * transport already authenticated the issuer. Everything a caller could
 * influence is checked.
 */
export function verifyIdTokenClaims(
  claims: IdTokenClaims,
  expected: { clientId: string; nonce: string; now?: number },
): GoogleProfile {
  const now = expected.now ?? Math.floor(Date.now() / 1000);
  if (!ISSUERS.includes(String(claims.iss)))
    throw new Error('Google sign-in failed: unexpected token issuer.');
  if (claims.aud !== expected.clientId)
    throw new Error('Google sign-in failed: this token was issued for another application.');
  // Without this, a token minted for a different app could be replayed here.
  if (typeof claims.sub !== 'string' || !claims.sub)
    throw new Error('Google sign-in failed: no account identifier.');
  if (claims.nonce !== expected.nonce)
    throw new Error('Google sign-in failed: the request did not match this browser.');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now)
    throw new Error('Google sign-in expired. Try again.');
  if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW_SECONDS > now)
    throw new Error('Google sign-in failed: the token is not valid yet.');
  // An unverified address must never match an existing account by email; that
  // is how someone would take over an account they do not own.
  if (claims.email_verified !== true)
    throw new Error('Google has not verified this address. Use a verified Google account.');
  const email = normalizeEmail(claims.email);
  let name: string;
  try {
    name = normalizeName(claims.name);
  } catch {
    name = email.split('@')[0].slice(0, 80);
  }
  return { sub: claims.sub, email, name };
}
/** Decodes a JWT payload without verifying it. Only safe on a token received
 *  directly from the token endpoint; never on one supplied by a browser. */
export function decodeIdTokenPayload(token: unknown): IdTokenClaims {
  if (typeof token !== 'string') throw new Error('Google sign-in returned no identity token.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Google sign-in returned a malformed identity token.');
  const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  try {
    const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return JSON.parse(
      new TextDecoder().decode(Uint8Array.from(text, (c) => c.charCodeAt(0))),
    ) as IdTokenClaims;
  } catch {
    throw new Error('Google sign-in returned an unreadable identity token.');
  }
}
/** The state cookie carries the nonce and the post-sign-in destination in one
 *  value, so a tampered callback cannot redirect somewhere of its choosing. */
export function packState(nonce: string, next: string): string {
  return `${nonce}:${next}`;
}
export function unpackState(
  value: unknown,
): { nonce: string; next: string } | null {
  if (typeof value !== 'string') return null;
  const at = value.indexOf(':');
  if (at <= 0) return null;
  return { nonce: value.slice(0, at), next: value.slice(at + 1) };
}
