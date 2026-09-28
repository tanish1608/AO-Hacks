import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelCallError, modelSettings, openRouterModel, workbenchModel } from '../lib/workbench/model.ts';
import { DEFAULT_MODEL } from '../lib/workbench/models.ts';

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

void test('a workflow chooses its model, and only from the allowlist', () => {
  const env = { OPENROUTER_API_KEY: 'key' };
  assert.equal(modelSettings(env, 'openai/gpt-6-luna').model, 'openai/gpt-6-luna');
  // An unknown id must not reach the provider: it would fail every structured
  // call. Fall back to the deployment default instead.
  assert.equal(modelSettings(env, 'openai/not-a-model').model, DEFAULT_MODEL);
  assert.equal(modelSettings(env, undefined).model, DEFAULT_MODEL);
  // An explicit FOUNDRY_MODEL still wins when a workflow expressed no choice.
  assert.equal(modelSettings({ ...env, FOUNDRY_MODEL: 'openai/pinned' }).model, 'openai/pinned');
  // Gemini addresses its models by another name, so a workflow choice made for
  // OpenRouter must not be handed to it.
  assert.equal(
    modelSettings({ GEMINI_API_KEY: 'k', FOUNDRY_PROVIDER: 'gemini' }, 'openai/gpt-6-luna').model,
    'gemini-3.8-flash',
  );
});

void test('selected provider cannot silently fall back to Gemini', () => {
  const env = { FOUNDRY_PROVIDER: 'openrouter', GEMINI_API_KEY: 'old' };
  assert.equal(modelSettings(env).key, '');
  assert.throws(() => workbenchModel(env), /OpenRouter credentials/);
  assert.equal(modelSettings({ OPENROUTER_API_KEY: 'key' }).model, DEFAULT_MODEL);
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
  // Truncated twice: say what to do about it, since the fix is to ask this step
  // for less rather than to retry again.
  await assert.rejects(
    openRouterModel(settings, async () => {
      calls++;
      return Response.json(completion(0.002, 'length'));
    }).json('JSON', {}, schema),
    /ran out of output budget/,
  );
  assert.equal(calls, 2);
});

void test('a timed-out request is retried once, then reported as a transport failure', async () => {
  // This is what lost a whole seeding run: one slow generation threw, and the
  // message blamed billing metadata instead of the response never arriving.
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
  };
  await assert.rejects(
    openRouterModel(settings, fetcher).json('JSON', {}, schema),
    (e: ModelCallError) => {
      assert.match(e.message, /did not respond in time/);
      assert.match(e.message, /TimeoutError/);
      assert.equal(e.usage.costUsd, null);
      return true;
    },
  );
  assert.equal(calls, 2, 'a transport failure should be retried once');
});

void test('a transport failure that recovers on the retry returns the value', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    if (++calls === 1) throw new Error('socket hang up');
    return Response.json(completion(0.003));
  };
  const result = await openRouterModel(settings, fetcher).json('JSON', {}, schema);
  assert.equal(calls, 2);
  assert.deepEqual(result.value, { ok: true });
  // The abandoned attempt may still have been billed and its cost is unknown,
  // so the total stays unknown rather than claiming only the second call's
  // price. Unknown is never reported as a number.
  assert.equal(result.usage.costUsd, null);
  assert.equal(result.usage.inputTokens, 10);
});

void test('an unreadable body is not reported as a billing problem', async () => {
  const fetcher: typeof fetch = async () => new Response('<html>gateway</html>', { status: 200 });
  await assert.rejects(
    openRouterModel({ ...settings, maxAttempts: 1 }, fetcher).json('JSON', {}, schema),
    (e: ModelCallError) => {
      assert.match(e.message, /could not be read/);
      return true;
    },
  );
});

void test('the request timeout is configurable and defaults above a minute', async () => {
  let signalled: AbortSignal | undefined;
  const fetcher: typeof fetch = async (_url, init) => {
    signalled = init?.signal ?? undefined;
    return Response.json(completion());
  };
  await openRouterModel(settings, fetcher).json('JSON', {}, schema);
  assert.ok(signalled, 'the request should carry an abort signal');
});
