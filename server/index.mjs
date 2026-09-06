import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAssets } from './assets.mjs';
import { SqliteD1 } from './d1-sqlite.mjs';
import { assignEnv, env } from './workers-shim.mjs';
import { migrate } from './migrate.mjs';
import { restore, scheduleSnapshot, shutdown } from './persistence.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const DIST = process.env.DIST_DIR ?? join(root, 'dist');
const DATA = process.env.DATA_DIR ?? join(root, '.data');
const PORT = Number(process.env.PORT ?? 8080);
mkdirSync(DATA, { recursive: true });
const dbFile = join(DATA, 'foundry.sqlite');
await restore(dbFile);
const db = new SqliteD1(dbFile, { onWrite: scheduleSnapshot });
const applied = migrate(db.db, process.env.MIGRATIONS_DIR ?? join(root, 'drizzle'));
if (applied.length) console.log(`applied migrations: ${applied.join(', ')}`);
// Only the app's own configuration crosses into the worker; the rest of the
// process environment stays out of application code.
const CONFIG = [
  // AUTH_MODE must reach the app: without it the header-trusting path stays
  // live behind IAP and anyone could forge an identity.
  'AUTH_MODE',
  'IAP_AUDIENCE',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'FOUNDRY_MODEL',
  'FOUNDRY_INPUT_PRICE_PER_MILLION',
  'FOUNDRY_OUTPUT_PRICE_PER_MILLION',
  'COMPOSIO_API_KEY',
  'LANGSMITH_API_KEY',
  'LANGSMITH_PROJECT',
  'LANGSMITH_TRACE_CONTENT',
];
const assets = createAssets(join(DIST, 'client'));
assignEnv({
  DB: db,
  ASSETS: assets,
  ...Object.fromEntries(
    CONFIG.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
  ),
});
// The bundle imports `cloudflare:workers` at module scope, so the resolver has
// to be registered before it is loaded.
register('./loader.mjs', import.meta.url);
const worker = (
  await import(pathToFileURL(join(DIST, 'server', 'index.js')).href)
).default;
function toRequest(req) {
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  const url = new URL(req.url, `${proto}://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers))
    for (const one of Array.isArray(value) ? value : [value])
      if (one !== undefined) headers.append(key, one);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  });
}
async function handle(request) {
  // Cloudflare serves dist/client from its own asset layer before the Worker
  // ever runs, so the Worker only routes pages. Node has no such layer: without
  // this the /_next/* chunks fall through to the router and 404, leaving an
  // unstyled page with no client JS.
  if (request.method === 'GET' || request.method === 'HEAD') {
    const asset = await assets.fetch(request);
    if (asset.status === 200) return asset;
  }
  return worker.fetch(request, env, {
    waitUntil: () => {},
    passThroughOnException: () => {},
  });
}
const server = createServer(async (req, res) => {
  try {
    const response = await handle(toRequest(req));
    const headers = {};
    for (const [key, value] of response.headers) headers[key] = value;
    res.writeHead(response.status, headers);
    if (response.body) await pipeline(Readable.fromWeb(response.body), res);
    else res.end();
  } catch (error) {
    console.error('request failed', error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal error');
  }
});
server.listen(PORT, '0.0.0.0', () =>
  console.log(`agent-foundry listening on ${PORT}`),
);
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    server.close();
    await shutdown(db, dbFile);
    process.exit(0);
  });
