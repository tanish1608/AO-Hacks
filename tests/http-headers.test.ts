import { strict as assert } from 'node:assert';
import test from 'node:test';
import { toNodeHeaders } from '../server/http.mjs';

void test('every Set-Cookie survives, not just the last one', () => {
  // The Google callback sets the session and clears the OAuth state in one
  // response. Collapsing those into a single header kept only the clear, so the
  // person was signed in and bounced straight back to the sign-in page.
  const headers = new Headers({ Location: '/app' });
  headers.append('Set-Cookie', 'foundry_session=TOKEN; Path=/; HttpOnly; Secure');
  headers.append('Set-Cookie', 'foundry_oauth=; Path=/api/auth; Max-Age=0');
  const out = toNodeHeaders(new Response(null, { status: 303, headers }));
  assert.deepEqual(out['set-cookie'], [
    'foundry_session=TOKEN; Path=/; HttpOnly; Secure',
    'foundry_oauth=; Path=/api/auth; Max-Age=0',
  ]);
  assert.equal(out.location, '/app');
});

void test('a single cookie is still passed through', () => {
  const headers = new Headers();
  headers.append('Set-Cookie', 'foundry_session=ONE; Path=/');
  const out = toNodeHeaders(new Response(null, { headers }));
  assert.deepEqual(out['set-cookie'], ['foundry_session=ONE; Path=/']);
});

void test('a response with no cookies carries no set-cookie key', () => {
  const out = toNodeHeaders(
    new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
  );
  assert.equal('set-cookie' in out, false);
  assert.equal(out['content-type'], 'application/json');
});

void test('ordinary headers are preserved alongside cookies', () => {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  headers.append('Set-Cookie', 'a=1');
  const out = toNodeHeaders(new Response(null, { headers }));
  assert.equal(out['cache-control'], 'no-store');
  assert.equal(out['x-content-type-options'], 'nosniff');
  assert.deepEqual(out['set-cookie'], ['a=1']);
});
