# Running on Google Cloud

The application is built for Cloudflare Workers with a D1 binding. On Google
Cloud the same bundle runs on Cloud Run behind a small Node adapter, so there
is one codebase and one SQL dialect rather than a fork.

- **Live service:** https://agent-foundry-826928184760.us-central1.run.app
- **Project:** `ao-hacks` (826928184760), region `us-central1`

## How the adapter works

`server/index.mjs` starts a Node HTTP server, converts each request to a Web
`Request`, and calls the Worker bundle's `fetch` export.

- `server/loader.mjs` resolves `cloudflare:workers` to `server/workers-shim.mjs`.
  Four server modules import `env` at module scope, so the shim's `env` object
  is populated before the bundle is imported and its identity never changes.
- `server/d1-sqlite.mjs` implements D1's surface — `prepare/bind/first/all/run`
  and a transactional `batch` — over better-sqlite3. This keeps the ~25 existing
  queries and the lease/revision concurrency control exactly as written.
- `server/assets.mjs` replaces the Workers `ASSETS` binding, serving `dist/client`.
- `server/migrate.mjs` applies `drizzle/*.sql` at boot, tracked in a
  `_migrations` table, since there is no `wrangler d1 migrations apply` here.
- Only an explicit allowlist of configuration keys is copied into the worker
  env. Nothing else from the process environment reaches application code.

## Authentication

`app/chatgpt-auth.ts` trusts `oai-authenticated-user-id` headers, which the
OpenAI Sites platform injects and strips. Nothing on Cloud Run does either, so
with `AUTH_MODE=iap` that path is disabled and identity comes only from a
verified IAP assertion.

`lib/server/iap.ts` verifies the `x-goog-iap-jwt-assertion` ES256 signature
against Google's published keys and checks issuer, audience and expiry. The
plain `x-goog-authenticated-user-*` headers are deliberately ignored: they are
only trustworthy because IAP strips inbound copies, which is not a property
this code can verify for itself.

Access is granted per user:

```sh
gcloud beta iap web add-iam-policy-binding --project=ao-hacks --region=us-central1 \
  --resource-type=cloud-run --service=agent-foundry \
  --member="user:SOMEONE@example.com" --role=roles/iap.httpsResourceAccessor
```

## Data durability, and its limit

SQLite lives on the instance filesystem, which does not survive a restart, so
it is restored from `gs://ao-hacks-foundry-db` at boot and snapshotted back
after writes (debounced, plus a final snapshot on SIGTERM).

**This requires `--max-instances=1`.** Two instances would each hold their own
copy of the file and the last snapshot would win, silently discarding the
other's work. `--min-instances=1` keeps the instance warm so snapshots are not
constantly restoring. Moving past one instance means moving to Cloud SQL and
porting the queries.

A snapshot is only as fresh as the last debounce window, so a hard crash can
lose a few seconds of writes. Acknowledged commits survive the process itself
(`synchronous = FULL`), not the instance.

## Deploying a change

```sh
IMAGE="us-central1-docker.pkg.dev/ao-hacks/foundry/agent-foundry:$(date +%Y%m%d-%H%M%S)"
gcloud builds submit --project=ao-hacks --tag="$IMAGE" --timeout=1800s .
gcloud run deploy agent-foundry --image="$IMAGE" --project=ao-hacks --region=us-central1 \
  --no-allow-unauthenticated --max-instances=1 --min-instances=1 \
  --set-env-vars="FOUNDRY_MODEL=gemini-3.8-flash,LANGSMITH_PROJECT=ao-hack,DB_BUCKET=ao-hacks-foundry-db,DATA_DIR=/data,AUTH_MODE=iap,IAP_AUDIENCE=/projects/826928184760/locations/us-central1/services/agent-foundry" \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest,COMPOSIO_API_KEY=COMPOSIO_API_KEY:latest,LANGSMITH_API_KEY=LANGSMITH_API_KEY:latest"
```

Secrets live in Secret Manager; `.dev.vars` is never deployed.

Run the adapter locally with `npm run serve` after `npm run build`. Without
`AUTH_MODE=iap` it keeps the header-based path, which is fine on localhost and
must never be how it is exposed publicly.
