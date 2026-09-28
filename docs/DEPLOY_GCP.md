# Running on Google Cloud

The application is built for Cloudflare Workers with a D1 binding. On Google
Cloud the same bundle runs on Cloud Run behind a small Node adapter, so there
is one codebase and one SQL dialect rather than a fork.

- **Service:** `agent-foundry`, project `ao-hacks` (826928184760), region `us-central1`
- **Access:** public HTTP. The application authenticates its own users; there is
  no proxy in front of it.

## How the adapter works

`server/index.mjs` starts a Node HTTP server, converts each request to a Web
`Request`, and calls the Worker bundle's `fetch` export.

- `server/loader.mjs` resolves `cloudflare:workers` to `server/workers-shim.mjs`.
  Several server modules import `env` at module scope, so the shim's `env` object
  is populated before the bundle is imported and its identity never changes.
- `server/d1-sqlite.mjs` implements D1's surface — `prepare/bind/first/all/run`
  and a transactional `batch` — over better-sqlite3. This keeps the existing
  queries and the lease/revision concurrency control exactly as written.
- `server/assets.mjs` replaces the Workers `ASSETS` binding, serving `dist/client`.
  Cloudflare serves those files ahead of the Worker; Node has no such layer, so
  the adapter checks assets first or every `/_next/*` chunk would 404.
- `server/migrate.mjs` applies `drizzle/*.sql` at boot, tracked in a
  `_migrations` table, since there is no `wrangler d1 migrations apply` here.
- Only an explicit allowlist of configuration keys is copied into the worker
  env. Nothing else from the process environment reaches application code.

## Authentication

Identity comes from a session cookie this application issues (`lib/server/auth.ts`):
a random 32-byte token, stored only as its SHA-256 digest, set `HttpOnly`,
`SameSite=Lax` and `Secure`. Passwords are PBKDF2-SHA256 with a per-account salt
(`lib/workbench/password.ts`).

**No request header is trusted to say who is calling.** The service is deployed
with `--allow-unauthenticated` because the application does the authenticating;
every route resolves the caller through `authorize()` or `requireUser()`, and
every row is owner-scoped.

This replaced Identity-Aware Proxy on September 28, 2026. IAP authenticated the
whole origin, which meant a published workflow link could not be opened by the
person it was shared with — they were refused before the application saw the
request. Shared links are now account-only rather than origin-only: anyone can
sign up, and running a shared workflow creates a private session under their own
account and their own connected apps.

`server/runtime-policy.mjs` still binds loopback unless `HOST` is set, so
`npm run serve` on a laptop does not serve a workspace to the local network. The
container image sets `HOST=0.0.0.0`.

## Data durability, and its limit

SQLite lives on the instance filesystem, which does not survive a restart, so
it is restored from `gs://ao-hacks-foundry-db` at boot and snapshotted back
after writes (debounced, retried, plus a final snapshot on SIGTERM).

Replacing that database is done by writing a **new object key** and pointing
the service at it in one deploy (`scripts/push-history-to-cloud.sh`), never by
overwriting the key in use. Scaling to zero first does not make an overwrite
safe: the scale change is itself a revision deploy, so an instance boots,
restores the current object, and writes it back when it retires — landing on
top of the upload. A retiring instance can only write to the key it booted
with, so a new key is immune.

**This requires `--max-instances=1`.** Two instances would each hold their own
copy of the file and the last snapshot would win, silently discarding the
other's work. `--min-instances=1` keeps the instance warm so snapshots are not
constantly restoring. Moving past one instance means moving to Cloud SQL and
porting the queries.

A snapshot is only as fresh as the last debounce window, so a hard crash can
lose a few seconds of writes. Acknowledged commits survive the process itself
(`synchronous = FULL`), not the instance. An upload that fails all its retries
is logged loudly and retried again at shutdown; until it succeeds the only copy
is on the instance.

## Deploying a change

```sh
IMAGE="us-central1-docker.pkg.dev/ao-hacks/foundry/agent-foundry:$(date +%Y%m%d-%H%M%S)"
gcloud builds submit --project=ao-hacks --tag="$IMAGE" --timeout=1800s .
gcloud run deploy agent-foundry --image="$IMAGE" --project=ao-hacks --region=us-central1 \
  --allow-unauthenticated --max-instances=1 --min-instances=1 \
  --set-env-vars="FOUNDRY_PROVIDER=openrouter,FOUNDRY_MODEL=openai/gpt-4o,LANGSMITH_PROJECT=ao-hack,DB_BUCKET=ao-hacks-foundry-db,DATA_DIR=/data" \
  --set-secrets="OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest,COMPOSIO_API_KEY=COMPOSIO_API_KEY:latest,LANGSMITH_API_KEY=LANGSMITH_API_KEY:latest"
```

Secrets live in Secret Manager; `.dev.vars` is never deployed. `DB_OBJECT` is
set separately by the database-replacement flow above and should not be included
in a routine `--set-env-vars`, which would reset it.

Run the adapter locally with `npm run serve` after `npm run build`.

## Claiming existing data after the auth change

Rows created before this change are owned by the old IAP subject
(`accounts.google.com:<numeric id>`). After signing up, move them to the new
account id:

```sh
python3 scripts/claim-workspace.py --database .data/foundry.sqlite \
  --from "accounts.google.com:113058574663273394504" --to "<new users.id>"
```

Run it against a downloaded copy of the database, then publish that copy under a
new object key, as above. The script refuses to run if the target owner already
has rows in a table keyed by owner.
