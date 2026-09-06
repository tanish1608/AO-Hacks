// Local names keep public search separate from privileged Composio meta tools.
export const SEARCH_TOOLS: Record<string, string> = {
  FOUNDRY_WEB_SEARCH: 'COMPOSIO_SEARCH_WEB',
  FOUNDRY_WEB_RESEARCH: 'COMPOSIO_SEARCH_TAVILY',
  FOUNDRY_FETCH_PUBLIC_PAGE: 'COMPOSIO_SEARCH_FETCH_URL_CONTENT',
  FOUNDRY_DUCKDUCKGO_SEARCH: 'COMPOSIO_SEARCH_DUCK_DUCK_GO',
};
export function searchAlias(slug: string, toolkit: string) {
  return toolkit.toLowerCase() === 'composio_search'
    ? Object.keys(SEARCH_TOOLS).find((key) => SEARCH_TOOLS[key] === slug)
    : undefined;
}
export function allowedDiscoveredSlug(slug: string, toolkit: string) {
  return !slug.startsWith('COMPOSIO_') || Boolean(searchAlias(slug, toolkit));
}
