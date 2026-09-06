import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_APPS,
  FINANCE_APPS,
  appDefinition,
  validateAppSelection,
} from '../lib/workbench/apps.ts';
import {
  allowedDiscoveredSlug,
  searchAlias,
} from '../lib/workbench/search-tools.ts';
import { ComposioGateway } from '../lib/workbench/composio.ts';
void test('full catalog supports finance apps and bounds task capabilities', () => {
  assert.ok(ALL_APPS.length > 1000);
  assert.equal(new Set(ALL_APPS.map((a) => a.slug)).size, ALL_APPS.length);
  for (const s of FINANCE_APPS) assert.ok(appDefinition(s));
  assert.deepEqual(validateAppSelection(['quickbooks', 'xero', 'serpapi']), [
    'quickbooks',
    'xero',
    'serpapi',
  ]);
  assert.throws(() => validateAppSelection(['nonexistent_app']));
  assert.throws(() => validateAppSelection(Array(9).fill('github')));
});
void test('search aliases do not admit privileged meta tools or spoofed toolkits', () => {
  assert.equal(
    searchAlias('COMPOSIO_SEARCH_WEB', 'composio_search'),
    'FOUNDRY_WEB_SEARCH',
  );
  assert.equal(allowedDiscoveredSlug('COMPOSIO_SEARCH_WEB', 'gmail'), false);
  assert.equal(
    allowedDiscoveredSlug('COMPOSIO_MANAGE_CONNECTIONS', 'composio_search'),
    false,
  );
  assert.equal(
    allowedDiscoveredSlug('COMPOSIO_SEARCH_GROQ_CHAT', 'composio_search'),
    false,
  );
});
void test('discovered web search preserves schema and dispatches the exact provider tool', async () => {
  const calls: Record<string, unknown>[] = [];
  const g = new ComposioGateway('test-key', async (_url, options) => {
    assert.equal(typeof options?.body, 'string');
    const body = JSON.parse(options!.body as string);
    calls.push(body);
    if (body.queries)
      return Response.json({
        tool_schemas: {
          search: {
            toolkit: 'COMPOSIO_SEARCH',
            tool_slug: 'COMPOSIO_SEARCH_WEB',
            description: 'Web search',
            input_schema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
            hasFullSchema: true,
          },
          meta: {
            toolkit: 'COMPOSIO_SEARCH',
            tool_slug: 'COMPOSIO_MANAGE_CONNECTIONS',
            input_schema: { type: 'object' },
            hasFullSchema: true,
          },
        },
        toolkit_connection_statuses: [
          { toolkit: 'composio_search', has_active_connection: true },
        ],
      });
    return Response.json({
      data: {
        citations: [{ url: 'https://www.rfc-editor.org/info/rfc9110/' }],
      },
      successful: true,
    });
  });
  const tools = await g.search('session', 'RFC', ['composio_search']);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].slug, 'FOUNDRY_WEB_SEARCH');
  assert.equal(tools[0].connected, true);
  assert.equal(tools[0].readOnly, true);
  assert.deepEqual(tools[0].schema.required, ['query']);
  await g.execute('session', tools[0].slug, { query: 'RFC 9110' });
  assert.deepEqual(calls[1], {
    tool_slug: 'COMPOSIO_SEARCH_WEB',
    arguments: { query: 'RFC 9110' },
  });
});
