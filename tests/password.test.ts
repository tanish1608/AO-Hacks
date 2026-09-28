import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  decoyHash,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from '../lib/workbench/password.ts';

void test('a stored hash verifies only the password that made it', async () => {
  const stored = await hashPassword('a quiet blue lamp');
  assert.match(stored, /^pbkdf2\$210000\$[^$]+\$[^$]+$/);
  assert.equal(await verifyPassword('a quiet blue lamp', stored), true);
  assert.equal(await verifyPassword('a quiet blue lamps', stored), false);
  assert.equal(await verifyPassword('', stored), false);
});

void test('the same password hashes differently every time', async () => {
  // Distinct salts: two accounts sharing a password must not share a hash, or
  // one cracked row would reveal both.
  const [a, b] = await Promise.all([hashPassword('same pass phrase'), hashPassword('same pass phrase')]);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('same pass phrase', a), true);
  assert.equal(await verifyPassword('same pass phrase', b), true);
});

void test('malformed or downgraded stored hashes never verify', async () => {
  for (const bad of [
    '',
    'plaintext',
    'pbkdf2$210000$onlythree',
    'bcrypt$10$salt$hash',
    'pbkdf2$1$c2FsdA==$aGFzaA==', // an attacker-lowered work factor
    'pbkdf2$abc$c2FsdA==$aGFzaA==',
    'pbkdf2$210000$!!!$!!!',
  ])
    assert.equal(await verifyPassword('anything', bad), false, `accepted ${bad}`);
});

void test('the decoy hash is well formed and matches nothing', async () => {
  const decoy = decoyHash();
  assert.match(decoy, /^pbkdf2\$210000\$/);
  assert.equal(await verifyPassword('', decoy), false);
  assert.equal(await verifyPassword('password', decoy), false);
});

void test('session tokens are stored only as a digest', async () => {
  const token = 'Ul9kZXNjcmliZWQtdG9rZW4';
  const hashed = await sha256Hex(token);
  assert.match(hashed, /^[0-9a-f]{64}$/);
  assert.notEqual(hashed, token);
  assert.equal(hashed, await sha256Hex(token));
  assert.notEqual(hashed, await sha256Hex(token + 'x'));
});
