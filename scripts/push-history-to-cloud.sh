#!/usr/bin/env bash
# Merge local task history into the deployed database.
#
# The instance snapshots to Cloud Storage after writes and again on shutdown,
# so an upload to the object a live instance is using will be overwritten by
# that instance's own snapshot. Scaling to zero does not avoid this: the scale
# change is itself a revision deploy, which boots an instance that restores the
# current object and writes it back when it retires.
#
# So the merged database is written to a NEW object key and the service is
# pointed at it in one deploy. A retiring instance can only write to the key it
# booted with, which nothing reads any more. No sleeps, no ordering assumptions.
set -euo pipefail
PROJECT=ao-hacks
REGION=us-central1
SERVICE=agent-foundry
BUCKET=gs://ao-hacks-foundry-db
SOURCE="${1:?usage: push-history-to-cloud.sh <local-sqlite> [from-owner]}"
FROM_OWNER="${2:-local_seedy}"
TO_OWNER=open-workspace
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

CURRENT=$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="value(spec.template.spec.containers[0].env)" 2>/dev/null \
  | tr ';' '\n' | sed -n "s/.*'DB_OBJECT', 'value': '\([^']*\)'.*/\1/p" | head -1)
CURRENT=${CURRENT:-foundry.sqlite}
NEXT="foundry-$(date +%Y%m%d-%H%M%S).sqlite"
echo "1/4 reading the live database ($CURRENT)"
gcloud storage cp "$BUCKET/$CURRENT" "$WORK/target.sqlite" --project="$PROJECT"

echo "2/4 merging local history"
python3 "$(dirname "$0")/import-history.py" \
  --source "$SOURCE" --target "$WORK/target.sqlite" \
  --from-owner "$FROM_OWNER" --to-owner "$TO_OWNER"

echo "3/4 writing $NEXT"
gcloud storage cp "$WORK/target.sqlite" "$BUCKET/$NEXT" --project="$PROJECT"

echo "4/4 pointing the service at it"
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --update-env-vars="DB_OBJECT=$NEXT" --quiet >/dev/null
echo "done — previous database kept at $BUCKET/$CURRENT"
