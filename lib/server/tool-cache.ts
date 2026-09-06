import { digest } from '../engine/runtime';
import type { ComposioGateway } from '../workbench/composio';
import { applyLiveness, cacheKeyInput, stripLiveness } from '../workbench/tool-cache';
import type { DiscoveredTool } from '../workbench/types';
import { database } from './store';
const TTL_MS = 24 * 60 * 60 * 1000;
type Cached = Omit<DiscoveredTool, 'connected' | 'source'>;
export async function readSchemaCache(
  owner: string,
  query: string,
  toolkits: string[],
): Promise<Cached[] | null> {
  const id = await digest(cacheKeyInput(owner, query, toolkits));
  const row = await database()
    .prepare(
      'SELECT payload FROM tool_schema_cache WHERE id=? AND owner_id=? AND expires_at>?',
    )
    .bind(id, owner, new Date().toISOString())
    .first<{ payload: string }>();
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.payload);
    return Array.isArray(parsed) && parsed.length ? (parsed as Cached[]) : null;
  } catch {
    return null;
  }
}
export async function writeSchemaCache(
  owner: string,
  query: string,
  toolkits: string[],
  tools: DiscoveredTool[],
) {
  if (!tools.length) return;
  const id = await digest(cacheKeyInput(owner, query, toolkits));
  const at = new Date();
  await database()
    .prepare(
      'INSERT INTO tool_schema_cache(id,owner_id,toolkits,payload,created_at,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at,expires_at=excluded.expires_at',
    )
    .bind(
      id,
      owner,
      [...toolkits].map((t) => t.toLowerCase()).sort().join(','),
      // Connection status is never stored, so a stale "connected" is impossible.
      JSON.stringify(stripLiveness(tools)),
      at.toISOString(),
      new Date(at.getTime() + TTL_MS).toISOString(),
    )
    .run();
}
/**
 * Which toolkits currently have an authorized account. Returns null when the
 * answer is uncertain, which forces a real search rather than a guess: the
 * engine blocks a run on `connected === false`, and inventing `true` here would
 * defeat that check silently.
 */
export async function liveToolkits(
  gateway: ComposioGateway,
  sessionId: string,
): Promise<Set<string> | null> {
  try {
    const items = (await gateway.connections(sessionId)).items;
    if (!items) return null;
    return new Set(
      items
        .filter(
          (c) =>
            c.is_no_auth === true ||
            c.connected_account?.status === 'ACTIVE' ||
            c.connection?.is_active === true ||
            c.connection?.isActive === true ||
            c.connection?.connected_account?.status === 'ACTIVE',
        )
        .map((c) => c.slug.toLowerCase()),
    );
  } catch {
    return null;
  }
}
export { applyLiveness };
