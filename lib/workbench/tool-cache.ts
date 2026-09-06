import type { DiscoveredTool } from './types.ts';
/**
 * Discovered schemas are stable enough to cache; connection status is not.
 * `connected` is stripped before storage so a stale "connected" is impossible
 * by construction — the engine blocks a run on `connected === false`, and
 * serving that from cache would silently defeat the check.
 */
export function cacheKeyInput(
  owner: string,
  query: string,
  toolkits: string[],
) {
  return {
    owner,
    toolkits: [...toolkits].map((t) => t.toLowerCase()).sort(),
    q: query
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160),
  };
}
export function stripLiveness(
  tools: DiscoveredTool[],
): Omit<DiscoveredTool, 'connected' | 'source'>[] {
  return tools.map(({ connected: _connected, source: _source, ...rest }) => rest);
}
/** Re-attaches live connection status to cached schemas. */
export function applyLiveness(
  cached: Omit<DiscoveredTool, 'connected' | 'source'>[],
  live: Set<string>,
): DiscoveredTool[] {
  return cached.map((t) => ({
    ...t,
    connected: live.has(t.toolkit.toLowerCase()),
    source: 'cache' as const,
  }));
}
