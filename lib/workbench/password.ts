/**
 * Password hashing, kept free of any storage import so it can be tested
 * directly (`lib/server/*` pulls in `cloudflare:workers`, which the test
 * runner cannot load).
 *
 * PBKDF2-SHA256 via WebCrypto: the one memory-hard-ish KDF available in both
 * the Worker runtime and Node without a native dependency.
 */
const ITERATIONS = 210_000;
const encoder = new TextEncoder();
export function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
export function unbase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
      key,
      256,
    ),
  );
}
/** pbkdf2$<iterations>$<salt>$<hash>, all base64, so the cost can be raised
 *  later without invalidating every stored password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${base64(salt)}$${base64(await derive(password, salt, ITERATIONS))}`;
}
/** Constant-time: an early exit would leak the hash one byte at a time. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !hash) return false;
  const rounds = Number(iterations);
  if (!Number.isInteger(rounds) || rounds < 1000 || rounds > 2_000_000)
    return false;
  let expected: Uint8Array, actual: Uint8Array;
  try {
    expected = unbase64(hash);
    actual = await derive(password, unbase64(salt), rounds);
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
  return diff === 0;
}
/** A well-formed hash of a value nobody can supply. Verifying against this on
 *  an unknown address keeps sign-in timing the same as a wrong password. */
export function decoyHash(): string {
  return `pbkdf2$${ITERATIONS}$${base64(new Uint8Array(16))}$${base64(new Uint8Array(32))}`;
}
export async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
