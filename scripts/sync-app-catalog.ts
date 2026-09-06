import { readFileSync, writeFileSync } from 'node:fs';
const vars = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ''),
      ];
    }),
);
if (!vars.COMPOSIO_API_KEY)
  throw new Error('Configure COMPOSIO_API_KEY in .dev.vars');
let cursor: string | undefined;
const items: {
  slug: string;
  name: string;
  description: string;
  icon: string;
  noAuth: boolean;
}[] = [];
do {
  const url = new URL('https://backend.composio.dev/api/v3/toolkits');
  url.searchParams.set('limit', '1000');
  if (cursor) url.searchParams.set('cursor', cursor);
  const r = await fetch(url, {
    headers: { 'x-api-key': vars.COMPOSIO_API_KEY },
  });
  if (!r.ok) throw new Error(`Catalog HTTP ${r.status}`);
  const d = (await r.json()) as {
    items: {
      slug: string;
      name: string;
      meta?: { description?: string };
      no_auth?: boolean;
    }[];
    next_cursor?: string;
  };
  for (const t of d.items)
    items.push({
      slug: t.slug,
      name: t.name,
      description: (t.meta?.description ?? '').slice(0, 180),
      icon: `https://logos.composio.dev/api/${t.slug}`,
      noAuth: Boolean(t.no_auth),
    });
  cursor = d.next_cursor;
  if (items.length > 10000) throw new Error('Catalog bound exceeded');
} while (cursor);
writeFileSync(
  'lib/workbench/app-catalog.json',
  JSON.stringify(
    items.sort((a, b) =>
      a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1,
    ),
  ) + '\n',
);
console.log(
  `Synced ${items.length} toolkit definitions. No account credentials are stored in the catalog.`,
);
