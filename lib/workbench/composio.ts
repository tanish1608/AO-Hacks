import { isReviewedRead } from './tool-policy.ts';
import type { DiscoveredTool } from './types.ts';
type Schema = {
  toolkit: string;
  tool_slug: string;
  description: string;
  input_schema?: Record<string, unknown>;
  hasFullSchema?: boolean;
  annotations?: { readOnlyHint?: boolean };
};
export class ComposioGateway {
  key: string;
  fetcher: typeof fetch;
  constructor(key: string, fetcher: typeof fetch = fetch) {
    this.key = key;
    this.fetcher = fetcher;
  }
  async request<T>(path: string, body?: unknown): Promise<T> {
    const r = await this.fetcher('https://backend.composio.dev/api/v3' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-api-key': this.key, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(35000),
    });
    if (!r.ok) {
      const raw = await r.text();
      throw new Error(
        `Composio HTTP ${r.status}: ${raw.replaceAll(this.key, '[redacted]').slice(0, 400)}`,
      );
    }
    return (await r.json()) as T;
  }
  async session(userId: string, toolkits?: string[]) {
    return this.request<{ session_id: string }>('/tool_router/session', {
      user_id: userId,
      ...(toolkits?.length ? { toolkits: { enable: toolkits } } : {}),
      workbench: { enable: false },
      manage_connections: { enable: true, enable_connection_removal: false },
    });
  }
  async search(
    sessionId: string,
    query: string,
    allowed: string[],
  ): Promise<DiscoveredTool[]> {
    const data = await this.request<{
      tool_schemas?: Record<string, Schema>;
      toolkit_connection_statuses?: {
        toolkit: string;
        has_active_connection: boolean;
      }[];
    }>(`/tool_router/session/${encodeURIComponent(sessionId)}/search`, {
      queries: [
        { use_case: query + ' Use these toolkits: ' + allowed.join(', ') },
      ],
      search_strategy: 'tool_search',
    });
    let selected = Object.values(data.tool_schemas ?? {})
      .filter(
        (t) =>
          allowed.includes(t.toolkit.toLowerCase()) &&
          !t.tool_slug.startsWith('COMPOSIO_'),
      )
      .slice(0, 5);
    const partial = selected
      .filter((t) => t.hasFullSchema === false || !t.input_schema)
      .map((t) => t.tool_slug);
    if (partial.length) {
      const full = await this.request<{
        data?: { tool_schemas?: Record<string, Schema> };
        error?: string;
      }>(`/tool_router/session/${encodeURIComponent(sessionId)}/execute_meta`, {
        slug: 'COMPOSIO_GET_TOOL_SCHEMAS',
        arguments: { tool_slugs: partial },
      });
      if (full.error)
        throw new Error('Composio could not retrieve full tool schemas');
      selected = selected.map(
        (t) => full.data?.tool_schemas?.[t.tool_slug] ?? t,
      );
    }
    return selected
      .filter(
        (t) =>
          t.input_schema &&
          allowed.includes(t.toolkit.toLowerCase()) &&
          !t.tool_slug.startsWith('COMPOSIO_'),
      )
      .map((t) => ({
        slug: t.tool_slug,
        toolkit: t.toolkit.toLowerCase(),
        description: t.description.slice(0, 1500),
        schema: t.input_schema!,
        readOnly: isReviewedRead(t.tool_slug, t.annotations?.readOnlyHint),
        connected: data.toolkit_connection_statuses?.find(
          (c) => c.toolkit.toLowerCase() === t.toolkit.toLowerCase(),
        )?.has_active_connection,
      }));
  }
  async execute(sessionId: string, slug: string, args: unknown) {
    const result = await this.request<{
      data?: unknown;
      error?: string;
      successful?: boolean;
    }>(`/tool_router/session/${encodeURIComponent(sessionId)}/execute`, {
      tool_slug: slug,
      arguments: args,
    });
    if (result.error || result.successful === false)
      throw new Error(result.error ?? 'Tool returned an unsuccessful result');
    return result.data ?? result;
  }
  async authorize(sessionId: string, toolkit: string, callback: string) {
    return this.request<{ redirect_url: string }>(
      `/tool_router/session/${encodeURIComponent(sessionId)}/link`,
      { toolkit, callback_url: callback },
    );
  }
  async connections(sessionId: string) {
    return this.request<{
      items?: {
        slug: string;
        name: string;
        logo?: string;
        connected_account?: { status: string };
        is_no_auth?: boolean;
        connection?: {
          is_active?: boolean;
          isActive?: boolean;
          connected_account?: { status: string };
        };
      }[];
    }>(
      `/tool_router/session/${encodeURIComponent(sessionId)}/toolkits?limit=50&is_connected=true`,
    );
  }
}
