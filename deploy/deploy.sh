#!/usr/bin/env bash
# Ships the working tree to the server and (re)builds the container there.
# Usage: deploy/deploy.sh [ssh-host]   (default: drift-vps from ~/.ssh/config)
set -euo pipefail
HOST="${1:-drift-vps}"
DIR=/opt/drift-oyunu
cd "$(dirname "$0")/.."
rsync -az --delete \
  --exclude node_modules --exclude '**/node_modules' --exclude .git --exclude 'game/dist' \
  --include 'controller/package.json' --exclude 'controller/*' \
  ./ "$HOST:$DIR/"
ssh "$HOST" "cd $DIR/deploy && docker compose up -d --build && docker image prune -f --filter label=app=drift-oyunu >/dev/null && docker compose ps"
