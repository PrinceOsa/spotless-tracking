#!/usr/bin/env bash
# ── Tracking POC deploy to the SpotlessDoc droplet ────────────────────────────
#
# Ships this repo to /opt/spotless-tracking-poc on the droplet, installs
# production deps remotely, and (re)starts the pm2 process. nginx and TLS are
# provisioned once on the droplet — they are NOT touched by this script.
#
# As with the main backend script: the prod .env is excluded so this can't
# overwrite live credentials. The droplet's .env lives at
# /opt/spotless-tracking-poc/.env and is owned by the operator.
#
# Usage:
#   bash scripts/deploy.sh
#   DROPLET=root@1.2.3.4 bash scripts/deploy.sh
#
set -euo pipefail

DROPLET="${DROPLET:-root@68.183.130.208}"
REMOTE_DIR="${REMOTE_DIR:-/opt/spotless-tracking-poc}"
PM2_NAME="${PM2_NAME:-spotless-tracking}"
HEALTH_URL="${HEALTH_URL:-https://tracking.spotlessdoc.com/health}"

EXCLUDES=(
  --exclude=.env
  --exclude=.env.local
  --exclude=.env.development
  --exclude=node_modules
  --exclude=.git
  --exclude='*.log'
)

echo "── syncing tracking source to $DROPLET:$REMOTE_DIR ──"
ssh "$DROPLET" "mkdir -p $REMOTE_DIR"
tar czf - "${EXCLUDES[@]}" . | ssh "$DROPLET" "cd $REMOTE_DIR && tar xzf -"

echo "── installing prod deps on droplet ──"
ssh "$DROPLET" "cd $REMOTE_DIR && npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -3"

echo "── restarting pm2 process ──"
ssh "$DROPLET" "pm2 restart $PM2_NAME --update-env 2>/dev/null || pm2 start $REMOTE_DIR/server.js --name $PM2_NAME --time"

echo "── waiting for /health ──"
for i in 1 2 3 4 5 6 8 10 13 16 ; do
  sleep 3
  if curl -fsS -m 1 "$HEALTH_URL" 2>/dev/null | grep -q '"ok"'; then
    echo "✓ UP at t=${i}s"
    curl -sS "$HEALTH_URL"
    echo
    exit 0
  fi
done

echo "✗ tracking server did not respond healthy within the wait window — check pm2 logs $PM2_NAME"
exit 1
