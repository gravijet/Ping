#!/usr/bin/env bash
# Build the Flutter web app ("Ping Web") and publish it to the server's public
# web-app dir, so the web subdomain (WEB_APP_HOST, default
# example.invalid) serves the freshest build. Run it, then restart
# the server:
#   ./server/scripts/build-web.sh
#   sudo systemctl restart ping-server   # picks up the new bundle
#
# The bundle is served same-origin with /api and /ws (see server/src/webapp.js),
# so the web client needs no CORS and no build-time server URL. Output is a build
# artifact and is git-ignored.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB_SRC="$ROOT/app/build/web"
DEST_DIR="${WEB_APP_DIR:-$ROOT/server/public/webapp}"

echo "→ Baue Flutter-Web (release) …"
( cd "$ROOT/app" && flutter build web --release --no-wasm-dry-run )

if [ ! -f "$WEB_SRC/index.html" ]; then
  echo "❌ Kein Web-Build gefunden: $WEB_SRC/index.html" >&2
  exit 1
fi

echo "→ Veröffentliche nach $DEST_DIR …"
mkdir -p "$DEST_DIR"
# Mirror the build output (delete stale assets from previous builds).
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$WEB_SRC/" "$DEST_DIR/"
else
  rm -rf "${DEST_DIR:?}/"* 2>/dev/null || true
  cp -a "$WEB_SRC/." "$DEST_DIR/"
fi

VERSION="$(grep -E '^version:' "$ROOT/app/pubspec.yaml" | head -1 | awk '{print $2}' | tr -d '\r')"
echo "✓ Ping Web ${VERSION:-?} veröffentlicht → $DEST_DIR"
echo "  Aktiv nach: sudo systemctl restart ping-server"
