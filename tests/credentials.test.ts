import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  MIN_PASSWORD,
  normalizeEmail,
  normalizeName,
  passwordProblem,
  safeNextPath,
  validateLogin,
  validateSignup,
} from '../lib/workbench/credentials.ts';

void test('email is normalized to one stored form', () => {
  assert.equal(normalizeEmail('  Person@Example.COM '), 'person@example.com');
  for (const bad of ['', 'nope', 'a@b', 'a b@c.com', 'a@b.', '<x>@y.com', 'a'.repeat(250) + '@b.com'])
    assert.throws(() => normalizeEmail(bad), /valid email/, `accepted ${bad}`);
});

void test('name collapses whitespace and stays bounded', () => {
  assert.equal(normalizeName('  Ada   Lovelace '), 'Ada Lovelace');
  assert.throws(() => normalizeName('   '), /Enter your name/);
  assert.throws(() => normalizeName('x'.repeat(81)), /Enter your name/);
});

void test('password rules reject the strings people type instead of choosing one', () => {
  assert.equal(passwordProblem('correct horse battery'), null);
  assert.match(passwordProblem('short')!, /at least 10/);
  assert.match(passwordProblem('x'.repeat(201))!, /at most 200/);
  assert.match(passwordProblem(' padded password ')!, /leading or trailing/);
  assert.match(passwordProblem('aaaaaaaaaaaa')!, /longer mix/);
  assert.match(passwordProblem('MyPassword123')!, /too easy to guess/);
  assert.match(passwordProblem('1234567890abc')!, /too easy to guess/);
  assert.equal(passwordProblem('x'.repeat(MIN_PASSWORD - 1)) !== null, true);
});

void test('signup returns the normalized record and keeps the raw password', () => {
  const c = validateSignup({ email: ' A@B.io ', name: ' Ada ', password: 'a quiet blue lamp' });
  assert.deepEqual(c, { email: 'a@b.io', name: 'Ada', password: 'a quiet blue lamp' });
  assert.throws(() => validateSignup({ email: 'a@b.io', name: 'Ada', password: 'abc' }), /at least 10/);
});

void test('login validates shape without applying sign-up password rules', () => {
  // An existing account may predate a stricter rule; the check belongs at sign-up.
  assert.deepEqual(validateLogin({ email: 'A@B.io', password: 'old' }), {
    email: 'a@b.io',
    password: 'old',
  });
  assert.throws(() => validateLogin({ email: 'a@b.io', password: '' }), /Enter your email/);
});

void test('next path never leaves this origin', () => {
  assert.equal(safeNextPath('/w/abc?x=1#y'), '/w/abc?x=1#y');
  assert.equal(safeNextPath('/app'), '/app');
  for (const bad of [
    'https://evil.example/steal',
    '//evil.example',
    'javascript:alert(1)',
    'app',
    undefined,
    42,
  ])
    assert.equal(safeNextPath(bad), '/app', `allowed ${String(bad)}`);
  // Bouncing back to the auth pages would loop the person straight back here.
  assert.equal(safeNextPath('/login'), '/app');
  assert.equal(safeNextPath('/signup'), '/app');
});
