#!/usr/bin/env bash
# Merge local task history into the deployed database.
#
# The running instance snapshots to Cloud Storage after writes and again on
# shutdown, so it is scaled to zero first. Uploading underneath a live instance
# would be overwritten by its next snapshot.
set -euo pipefail
PROJECT=ao-hacks
REGION=us-central1
SERVICE=agent-foundry
BUCKET=gs://ao-hacks-foundry-db/foundry.sqlite
SOURCE="${1:?usage: push-history-to-cloud.sh <local-sqlite> [from-owner]}"
FROM_OWNER="${2:-local_seedy}"
TO_OWNER=open-workspace
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "1/5 stopping the instance so its final snapshot lands first"
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --min-instances=0 --quiet >/dev/null
sleep 25

echo "2/5 downloading the deployed database"
gcloud storage cp "$BUCKET" "$WORK/target.sqlite" --project="$PROJECT"
cp "$WORK/target.sqlite" "$WORK/target.backup.sqlite"

echo "3/5 merging local history"
python3 "$(dirname "$0")/import-history.py" \
  --source "$SOURCE" --target "$WORK/target.sqlite" \
  --from-owner "$FROM_OWNER" --to-owner "$TO_OWNER"

echo "4/5 uploading"
gcloud storage cp "$WORK/target.sqlite" "$BUCKET" --project="$PROJECT"
gcloud storage cp "$WORK/target.backup.sqlite" \
  "gs://ao-hacks-foundry-db/backups/foundry-$(date +%Y%m%d-%H%M%S).sqlite" --project="$PROJECT"

echo "5/5 starting a fresh instance, which restores the merged database"
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --min-instances=1 --quiet >/dev/null
echo "done"
