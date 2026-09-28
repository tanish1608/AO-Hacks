/**
 * Account input rules, kept pure so they can be tested without a database and
 * reused by the sign-up form and the API route. Every message here is shown to
 * a person, so it says what to do rather than what failed.
 */
export interface Credentials {
  email: string;
  name: string;
  password: string;
}
const EMAIL = /^[^\s@,;:<>"'\\]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;
/** Lowercased and trimmed; the stored form and the lookup key must agree. */
export function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL.test(email))
    throw new Error('Enter a valid email address.');
  return email;
}
export function normalizeName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 80)
    throw new Error('Enter your name, up to 80 characters.');
  return name;
}
/**
 * Length first, because it is the only property that reliably predicts
 * guessing cost. The rest blocks the handful of strings that get typed when
 * someone is not really choosing a password.
 */
export function passwordProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD)
    return `Use at least ${MIN_PASSWORD} characters.`;
  if (value.length > MAX_PASSWORD)
    return `Use at most ${MAX_PASSWORD} characters.`;
  if (value.trim() !== value)
    return 'Remove the leading or trailing spaces.';
  if (new Set(value.toLowerCase()).size < 4)
    return 'Use a longer mix of characters.';
  const plain = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (
    ['password', 'passw0rd', 'letmein', 'qwertyuiop', 'welcome', 'iloveyou', 'administrator']
      .some((weak) => plain.includes(weak)) ||
    /^(?:012345|123456|abcdef)/.test(plain)
  )
    return 'That password is too easy to guess. Choose something else.';
  return null;
}
export function validateSignup(input: unknown): Credentials {
  const body = (input ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const name = normalizeName(body.name);
  const problem = passwordProblem(body.password);
  if (problem) throw new Error(problem);
  return { email, name, password: body.password as string };
}
export function validateLogin(input: unknown): { email: string; password: string } {
  const body = (input ?? {}) as Record<string, unknown>;
  if (typeof body.password !== 'string' || !body.password || body.password.length > MAX_PASSWORD)
    throw new Error('Enter your email address and password.');
  return { email: normalizeEmail(body.email), password: body.password };
}
/**
 * Where to send someone after signing in. Only a same-origin path is allowed:
 * an attacker-supplied absolute URL here would turn the login page into an
 * open redirect that looks like it came from us.
 */
export function safeNextPath(value: unknown, fallback = '/app'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return fallback;
  let url: URL;
  try {
    url = new URL(value, 'https://foundry.local');
  } catch {
    return fallback;
  }
  if (url.origin !== 'https://foundry.local') return fallback;
  if (['/login', '/signup', '/logout'].includes(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
