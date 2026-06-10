#!/usr/bin/env bash
# Publish the latest Flutter release build to the server's public download dir,
# so https://example.invalid/ serves the newest APK. Run after building:
#   (cd app && flutter build apk --release)
#   server/scripts/publish-apk.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APK_SRC="$ROOT/app/build/app/outputs/flutter-apk/app-release.apk"
DEST_DIR="${APK_DIR:-$ROOT/server/public/downloads}"

if [ ! -f "$APK_SRC" ]; then
  echo "❌ Kein Release-Build gefunden: $APK_SRC" >&2
  echo "   Baue zuerst: (cd app && flutter build apk --release)" >&2
  exit 1
fi

# Read the version (e.g. 2.0.0+3) from pubspec.yaml.
VERSION="$(grep -E '^version:' "$ROOT/app/pubspec.yaml" | head -1 | awk '{print $2}' | tr -d '\r')"
VERSION="${VERSION:-2.0.0}"

mkdir -p "$DEST_DIR"
# Remove older published APKs so only the newest is offered.
rm -f "$DEST_DIR"/*.apk 2>/dev/null || true
cp "$APK_SRC" "$DEST_DIR/ping-${VERSION%%+*}.apk"

SIZE="$(stat -c%s "$APK_SRC")"
SHA="$(sha256sum "$APK_SRC" | awk '{print $1}')"
cat > "$DEST_DIR/version.json" <<EOF
{
  "version": "${VERSION%%+*}",
  "build": "$VERSION",
  "size": $SIZE,
  "sha256": "$SHA",
  "publishedAt": $(date +%s000)
}
EOF

echo "✅ Veröffentlicht: $DEST_DIR/ping-${VERSION%%+*}.apk ($((SIZE/1024/1024)) MB)"
echo "   Version $VERSION · sha256 ${SHA:0:16}…"
