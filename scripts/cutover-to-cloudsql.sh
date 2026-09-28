#!/bin/bash
# One-time cutover from the snapshotted SQLite file to Cloud SQL.
#
# Run the Cloud SQL Auth Proxy first; this never opens the database to the
# internet. Everything here is idempotent: the schema uses CREATE TABLE IF NOT
# EXISTS and the copy uses ON CONFLICT DO NOTHING, so a re-run after a partial
# failure resumes rather than duplicating or overwriting.
#
#   scripts/cutover-to-cloudsql.sh <sqlite-file>
set -euo pipefail

PROJECT=ao-hacks
REGION=us-central1
INSTANCE=foundry-pg
CONNECTION="$PROJECT:$REGION:$INSTANCE"
SOURCE="${1:?usage: cutover-to-cloudsql.sh <sqlite-file>}"

: "${PGPASSWORD:?Set PGPASSWORD to the foundry database password}"
export DATABASE_URL="postgres://foundry:${PGPASSWORD}@127.0.0.1:5433/foundry"

echo "==> copying $SOURCE into $CONNECTION"
node scripts/migrate-to-postgres.mjs "$SOURCE" --apply

echo
echo "==> deploying Cloud Run against Cloud SQL"
IMAGE="us-central1-docker.pkg.dev/$PROJECT/foundry/agent-foundry:cloudsql-$(date +%Y%m%d-%H%M%S)"
gcloud builds submit --project="$PROJECT" --tag="$IMAGE" --timeout=1800s .
# max-instances is no longer pinned to 1: the database is shared and
# transactional, so instances no longer hold competing copies of it.
gcloud run deploy agent-foundry \
  --image="$IMAGE" --project="$PROJECT" --region="$REGION" \
  --add-cloudsql-instances="$CONNECTION" \
  --min-instances=1 --max-instances=4 --no-cpu-throttling \
  --update-secrets="DATABASE_URL=FOUNDRY_DATABASE_URL:latest" \
  --remove-env-vars="DB_BUCKET,DB_OBJECT" \
  --quiet
