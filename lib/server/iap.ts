import { env } from 'cloudflare:workers';
/**
 * Identity-Aware Proxy identity.
 *
 * IAP also sets x-goog-authenticated-user-email, but that header is only
 * trustworthy because IAP strips inbound copies of it. Anything that reaches
 * the container directly could forge it, so the signed assertion is verified
 * here instead and the plain headers are ignored.
 */
export interface IapUser {
  userId: string;
  email: string;
}
const JWKS_URL = 'https://www.gstatic.com/iap/verify/public_key-jwk';
const ISSUER = 'https://cloud.google.com/iap';
const CLOCK_SKEW_SECONDS = 60;
type Jwk = JsonWebKey & { kid: string };
let cache: { at: number; keys: Jwk[] } | null = null;
async function keys(): Promise<Jwk[]> {
  if (cache && Date.now() - cache.at < 3600_000) return cache.keys;
  const response = await fetch(JWKS_URL, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`IAP key fetch failed: ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  if (!body.keys?.length) throw new Error('IAP key set was empty');
  cache = { at: Date.now(), keys: body.keys };
  return body.keys;
}
function decodeSegment(segment: string): unknown {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return JSON.parse(
    new TextDecoder().decode(Uint8Array.from(text, (c) => c.charCodeAt(0))),
  );
}
function decodeSignature(segment: string): ArrayBuffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}
/** Returns the verified user, or null when the assertion is absent or invalid. */
export async function verifyIapAssertion(
  token: string | null,
): Promise<IapUser | null> {
  const audience = (env as unknown as Record<string, string | undefined>)
    .IAP_AUDIENCE;
  if (!token || !audience) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = decodeSegment(parts[0]) as { alg?: string; kid?: string };
    if (header.alg !== 'ES256' || !header.kid) return null;
    const jwk = (await keys()).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      decodeSignature(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const claims = decodeSegment(parts[1]) as {
      iss?: string;
      aud?: string;
      sub?: string;
      email?: string;
      exp?: number;
      iat?: number;
    };
    const now = Math.floor(Date.now() / 1000);
    // The audience is service-specific and easy to get wrong on first setup.
    // Report the mismatch (claim only, never the token or the user) so the
    // correct value is visible in logs instead of a blank sign-in failure.
    if (claims.aud !== audience)
      console.warn(
        `IAP audience mismatch: assertion carries "${claims.aud}", IAP_AUDIENCE is "${audience}"`,
      );
    if (
      claims.iss !== ISSUER ||
      claims.aud !== audience ||
      !claims.sub ||
      !claims.email ||
      typeof claims.exp !== 'number' ||
      typeof claims.iat !== 'number' ||
      claims.exp + CLOCK_SKEW_SECONDS < now ||
      claims.iat - CLOCK_SKEW_SECONDS > now
    )
      return null;
    return { userId: claims.sub, email: claims.email };
  } catch {
    return null;
  }
}
/**
 * 'iap'    verified Identity-Aware Proxy assertion.
 * 'open'   no sign-in: every visitor shares one workspace. For a private test
 *          deployment only — the server holds provider keys and connected app
 *          accounts, so anyone who can reach the URL can use them.
 * 'sites'  the OpenAI Sites headers, which only mean anything where that
 *          platform injects and strips them.
 */
export function authMode(): 'iap' | 'open' | 'sites' {
  const mode = (env as unknown as Record<string, string | undefined>).AUTH_MODE;
  return mode === 'iap' ? 'iap' : mode === 'open' ? 'open' : 'sites';
}
/** The single shared identity used in open mode. */
export const OPEN_USER = {
  userId: 'open-workspace',
  email: 'open@localhost',
};
