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

### Google sign-in

Optional, and hidden entirely when unconfigured. It uses the authorization-code
flow on a single path: `GET /api/auth/google` starts it, and Google returns to
the same path with `?code=`, which keeps the redirect URI one segment.

The ID token is read without re-verifying its signature, which is safe **only**
because it arrives directly from Google's token endpoint over TLS. Everything a
caller could influence is still checked in `verifyIdTokenClaims`: issuer,
audience, expiry, and the nonce carried in a short-lived `HttpOnly` state cookie.
`email_verified` must be true before an address is allowed to match an existing
account, or someone could claim an address they do not control.

The OAuth client cannot be created from the CLI — the IAP OAuth Admin API was
shut down in March 2026 and generic clients are Console-only:

1. APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.
2. Authorized redirect URIs. The redirect URI is rebuilt from the host of the
   incoming request, and Cloud Run answers on **two** hostnames — the
   project-number form and the generated one — so register both or a visitor who
   arrives on the other one gets `redirect_uri_mismatch`:
   - `https://agent-foundry-826928184760.us-central1.run.app/api/auth/google`
   - `https://agent-foundry-wylgntjyxa-uc.a.run.app/api/auth/google`
   - `http://127.0.0.1:3000/api/auth/google` for local development.
3. Store the secret, then point the service at it:

```sh
printf %s "<client-secret>" | gcloud secrets create GOOGLE_CLIENT_SECRET \
  --project=ao-hacks --data-file=-
gcloud run services update agent-foundry --project=ao-hacks --region=us-central1 \
  --update-env-vars="GOOGLE_CLIENT_ID=<client-id>" \
  --update-secrets="GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest"
```

### Why the image does not build under /app

`WORKDIR` is `/srv/foundry`, not `/app`. The App Router's own directory is
`app/`, so building under `/app` puts the routes at `/app/app/<route>/page.tsx`
and the landing page at `/app/app/page.tsx`. The first deploy of the accounts
branch served the workspace at `/` and the landing page nowhere, while the
identical source built on macOS routed both correctly — the route graph is right
on either platform, so the collapse happens later in the Linux build. Keeping the
working directory away from `app` removes the ambiguity instead of relying on
which normalization runs where. Do not move it back.

## Data: Cloud SQL

The service runs on **Cloud SQL for PostgreSQL** (`foundry-pg`, `db-g1-small`,
`us-central1`). Cloud Run reaches it through the built-in Cloud SQL Auth Proxy,
so the database has no authorized networks and is not reachable from the
internet. Set `DATABASE_URL` and the adapter uses Postgres; leave it unset and
it falls back to the SQLite file described below, which is still what local
development uses.

`server/d1-postgres.mjs` serves the same D1 surface the application already
speaks — `prepare/bind/first/all/run` and a transactional `batch` — so the
queries and the lease/revision concurrency control are unchanged. It handles the
two things that genuinely differ: `?` placeholders become `$1`, `$2`
(carefully, since a `?` inside a string literal must not be renumbered — that
would silently bind the wrong values to the wrong columns), and a `batch` pins a
single pooled client so its statements share one transaction.

The sidebar listing used to read `json_extract` and `json_array_length`, which
do not exist in Postgres. Those fields are now real columns (`chats.steps`,
`agent_runs.mode/error/pending_status`) maintained on write, which is both
faster and the same SQL on either engine. No query anywhere uses a JSON
function now.

**This is what allows more than one instance.** The SQLite path keeps the
database in the container's own filesystem, so a second instance would hold a
separate copy and the last snapshot back to Cloud Storage would silently
discard the other's work — which is why it was pinned to `--max-instances=1`.

To copy an existing SQLite database in, run the proxy locally and:

```sh
cloud-sql-proxy --port 5432 ao-hacks:us-central1:foundry-pg &
DATABASE_URL='postgres://foundry:PASSWORD@127.0.0.1:5432/foundry' \
  node scripts/migrate-to-postgres.mjs .data/foundry.sqlite --apply
```

It copies parents before children, inserts with `ON CONFLICT DO NOTHING` so a
re-run resumes rather than overwriting live rows, and fills the derived columns
from each payload when the source predates them.

## The previous SQLite path, and its limit

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

`agent_run_metrics` is written by `saveChat`, so runs that arrived any other way
— a seeded demo workspace, an imported database — have no row and leave the
Learning tab empty. Rebuild them with the same function the server uses:

```sh
node --experimental-strip-types scripts/backfill-run-metrics.ts \
  .data/foundry.sqlite --apply
```
