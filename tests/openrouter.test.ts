import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelCallError, modelSettings, openRouterModel, workbenchModel } from '../lib/workbench/model.ts';

const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const settings = { key: 'test-private-key', model: 'openai/gpt-4o', siteUrl: 'http://127.0.0.1:3000' };
const completion = (cost: number | undefined = 0.002, reason = 'stop', content = '{"ok":true}') => ({
  choices: [{ finish_reason: reason, message: { content } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, ...(cost === undefined ? {} : { cost }) },
});

void test('OpenRouter uses server credentials, strict schema, and provider-reported cost', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), `Bearer ${settings.key}`);
    assert.equal(headers.get('HTTP-Referer'), settings.siteUrl);
    assert.equal(typeof init?.body, 'string');
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, settings.model);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.provider.require_parameters, true);
    assert.equal(JSON.stringify(body).includes(settings.key), false);
    return Response.json(completion());
  };
  const result = await openRouterModel(settings, fetcher).json('Return JSON', {}, schema);
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.usage.costUsd, 0.002);
  assert.equal(result.usage.inputTokens, 10);
});

void test('selected provider cannot silently fall back to Gemini', () => {
  const env = { FOUNDRY_PROVIDER: 'openrouter', GEMINI_API_KEY: 'old' };
  assert.equal(modelSettings(env).key, '');
  assert.throws(() => workbenchModel(env), /OpenRouter credentials/);
  assert.equal(modelSettings({ OPENROUTER_API_KEY: 'key' }).model, 'openai/gpt-4o');
  assert.throws(() => modelSettings({ FOUNDRY_PROVIDER: 'typo' }), /must be/);
});

void test('truncated responses retry once and account for both charged calls', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => Response.json(completion(0.002, ++calls === 1 ? 'length' : 'stop'));
  const result = await openRouterModel(settings, fetcher).json('JSON', {}, schema);
  assert.equal(calls, 2);
  assert.equal(result.usage.inputTokens, 20);
  assert.equal(result.usage.outputTokens, 10);
  assert.equal(result.usage.costUsd, 0.004);
});

void test('absent cost stays unknown, including after a retry', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    const body = completion(0.002, ++calls === 1 ? 'length' : 'stop');
    if (calls === 1) delete body.usage.cost;
    return Response.json(body);
  };
  const result = await openRouterModel(settings, fetcher).json('JSON', {}, schema);
  assert.equal(result.usage.costUsd, null);
});

void test('schema violations and incomplete outputs fail with charged usage intact', async () => {
  for (const body of [completion(0.002, 'stop', '{"ok":"false"}'), completion(0.002, 'stop', 'invalid'), completion(0.002, 'content_filter')]) {
    await assert.rejects(openRouterModel(settings, async () => Response.json(body)).json('JSON', {}, schema), (error: unknown) => {
      assert.ok(error instanceof ModelCallError);
      assert.equal(error.usage.costUsd, 0.002);
      return true;
    });
  }
});

void test('credential errors redact the key and do not retry', async () => {
  let calls = 0;
  await assert.rejects(openRouterModel(settings, async () => {
    calls++;
    return Response.json({ error: { message: `Invalid ${settings.key}` } }, { status: 401 });
  }).json('JSON', {}, schema), (error: unknown) => {
    assert.ok(error instanceof ModelCallError);
    assert.equal(error.message.includes(settings.key), false);
    assert.equal(error.usage.costUsd, null);
    return true;
  });
  assert.equal(calls, 1);
});

void test('missing token usage and exhausted truncation cannot pass', async () => {
  await assert.rejects(openRouterModel(settings, async () => Response.json({ choices: [] })).json('JSON', {}, schema), /usage metadata/);
  let calls = 0;
  await assert.rejects(openRouterModel(settings, async () => { calls++; return Response.json(completion(0.002, 'length')); }).json('JSON', {}, schema), /incomplete/);
  assert.equal(calls, 2);
});
