import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  DEFAULT_MODEL,
  MODELS,
  modelChoice,
  resolveModel,
  validateModel,
} from '../lib/workbench/models.ts';

void test('the default is on the list', () => {
  assert.ok(modelChoice(DEFAULT_MODEL), `${DEFAULT_MODEL} is not in MODELS`);
});

void test('every entry is a well-formed OpenRouter id with real prices', () => {
  const ids = new Set<string>();
  for (const m of MODELS) {
    // The same pattern openRouterModel enforces before it will call anything.
    assert.match(m.id, /^[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._:/-]+$/, m.id);
    assert.equal(ids.has(m.id), false, `duplicate ${m.id}`);
    ids.add(m.id);
    assert.ok(m.name && m.maker && m.note, m.id);
    assert.ok(m.inputPrice > 0 && m.outputPrice > 0, m.id);
    assert.ok(m.contextTokens >= 100_000, m.id);
  }
  assert.ok(MODELS.length >= 4);
});

void test('a request body cannot choose a model off the list', () => {
  // An arbitrary id would fail every call: the engine only asks for strict
  // JSON schema responses, which not every model supports.
  assert.equal(validateModel('openai/gpt-6-sol'), 'openai/gpt-6-sol');
  assert.equal(validateModel(undefined), undefined);
  assert.equal(validateModel(''), undefined);
  const rejected: unknown[] = ['openai/not-a-model', 'anything', 42, {}, 'openai/gpt-6-sol '];
  for (const bad of rejected)
    assert.throws(
      () => validateModel(bad),
      /available models/,
      `accepted ${JSON.stringify(bad)}`,
    );
});

void test('a retired model falls back instead of breaking a saved workflow', () => {
  assert.equal(resolveModel('openai/gpt-6-luna', 'fallback/x'), 'openai/gpt-6-luna');
  assert.equal(resolveModel('openai/retired-model', 'fallback/x'), 'fallback/x');
  assert.equal(resolveModel(undefined, 'fallback/x'), 'fallback/x');
});
