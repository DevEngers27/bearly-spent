#!/usr/bin/env bash
# Build locally and publish to the server. Usage: deploy/azure/deploy.sh <user@host> [git-ref]
# The server must have been prepared once with setup-server.sh.
set -euo pipefail
TARGET="${1:?usage: deploy.sh <user@host> [git-ref]}"
REF="${2:-HEAD}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

git -C "$ROOT" archive --format=tar "$REF" | tar -x -C "$STAGE"
(cd "$STAGE" && npm ci --no-fund --no-audit >/dev/null && npm run build >/dev/null && rm -rf node_modules && npm ci --omit=dev --no-fund --no-audit >/dev/null)
VERSION="$(git -C "$ROOT" describe --tags --always "$REF")"
echo "$VERSION" > "$STAGE/VERSION"

rsync -az --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  --exclude '.git' --exclude 'data' --exclude 'client/src' --exclude 'bear_app_assets' --exclude 'bear_postcard_collection_15' \
  --exclude '*.test.js' --exclude '*.test.mjs' \
  "$STAGE"/ "$TARGET":/opt/moneyquest/
ssh "$TARGET" 'sudo chmod 755 /opt/moneyquest && sudo systemctl restart moneyquest && sleep 2 && systemctl is-active moneyquest && sudo journalctl -u moneyquest -n 3 --no-pager'
echo "deployed $VERSION to $TARGET"
