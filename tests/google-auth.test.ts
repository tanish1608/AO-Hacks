import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  authorizeUrl,
  decodeIdTokenPayload,
  packState,
  unpackState,
  verifyIdTokenClaims,
} from '../lib/workbench/google-auth.ts';

const NOW = 1_800_000_000;
const CLIENT = '123.apps.googleusercontent.com';
const good = {
  iss: 'https://accounts.google.com',
  aud: CLIENT,
  sub: '10769150350006150715113082367',
  email: 'Person@Example.com',
  email_verified: true,
  name: '  Ada  Lovelace ',
  nonce: 'n-0S6_WzA2Mj',
  exp: NOW + 3600,
  iat: NOW - 10,
};
const verify = (over: Record<string, unknown> = {}, nonce = good.nonce) =>
  verifyIdTokenClaims({ ...good, ...over }, { clientId: CLIENT, nonce, now: NOW });

void test('a valid token yields a normalized profile', () => {
  assert.deepEqual(verify(), {
    sub: good.sub,
    email: 'person@example.com',
    name: 'Ada Lovelace',
  });
});

void test('a token issued for another application is refused', () => {
  // Without the audience check, any Google app could mint a token that signs
  // its holder into this one.
  assert.throws(() => verify({ aud: 'someone-else.apps.googleusercontent.com' }), /another application/);
});

void test('an unverified Google address cannot match an account', () => {
  // This is the account-takeover path: Google lets a profile carry an address
  // it has not proven, and we link accounts by address.
  assert.throws(() => verify({ email_verified: false }), /has not verified/);
  assert.throws(() => verify({ email_verified: 'true' }), /has not verified/);
  assert.throws(() => verify({ email_verified: undefined }), /has not verified/);
});

void test('issuer, nonce, and timing are all enforced', () => {
  assert.throws(() => verify({ iss: 'https://evil.example' }), /token issuer/);
  assert.throws(() => verify({}, 'a-different-nonce'), /did not match this browser/);
  assert.throws(() => verify({ nonce: undefined }), /did not match this browser/);
  assert.throws(() => verify({ exp: NOW - 300 }), /expired/);
  assert.throws(() => verify({ iat: NOW + 300 }), /not valid yet/);
  assert.throws(() => verify({ exp: 'soon' }), /expired/);
  assert.throws(() => verify({ sub: '' }), /account identifier/);
  // accounts.google.com without a scheme is also a documented Google issuer.
  assert.equal(verify({ iss: 'accounts.google.com' }).email, 'person@example.com');
});

void test('a missing name falls back to the local part rather than failing', () => {
  assert.equal(verify({ name: '   ' }).name, 'person');
  assert.equal(verify({ name: undefined }).name, 'person');
});

void test('the authorize URL requests exactly what is needed', () => {
  const url = new URL(
    authorizeUrl({ clientId: CLIENT, redirectUri: 'https://app.test/api/auth/google', state: 's', nonce: 'n' }),
  );
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('client_id'), CLIENT);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.test/api/auth/google');
  assert.equal(url.searchParams.get('nonce'), 'n');
  assert.equal(url.searchParams.get('state'), 's');
});

void test('state survives a round trip and rejects junk', () => {
  const packed = packState('nonce-value', '/w/abc?x=1');
  assert.deepEqual(unpackState(packed), { nonce: 'nonce-value', next: '/w/abc?x=1' });
  for (const bad of ['', 'nocolon', ':/app', undefined, 7])
    assert.equal(unpackState(bad), null, `accepted ${String(bad)}`);
});

void test('id token payloads decode, and malformed ones throw', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
  assert.deepEqual(decodeIdTokenPayload(`header.${payload}.signature`), { sub: 'x' });
  for (const bad of ['', 'a.b', 'a.$$$.c', undefined, 12])
    assert.throws(() => decodeIdTokenPayload(bad), /identity token/, `accepted ${String(bad)}`);
});
