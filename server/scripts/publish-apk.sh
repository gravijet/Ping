#!/usr/bin/env bash
# Publish the latest Flutter release build(s) to the server's public download dir,
# so https://example.invalid/ serves the newest APK. Build first:
#   cd app
#   flutter build apk --split-per-abi --release   # smaller per-ABI APKs (optional)
#   flutter build apk --release                   # universal APK (required)
#   ../server/scripts/publish-apk.sh
#
# Publishing the splits lets the in-app updater download only the slice for the
# user's CPU (~40% smaller). Skip the split build and only the universal APK is
# published — everything still works, just with the larger download.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APK_SRC_DIR="$ROOT/app/build/app/outputs/flutter-apk"
UNIVERSAL_SRC="$APK_SRC_DIR/app-release.apk"
DEST_DIR="${APK_DIR:-$ROOT/server/public/downloads}"

if [ ! -f "$UNIVERSAL_SRC" ]; then
  echo "❌ Kein universelles Release-Build gefunden: $UNIVERSAL_SRC" >&2
  echo "   Baue zuerst: (cd app && flutter build apk --release)" >&2
  exit 1
fi

# Read the version (e.g. 2.7.0+10) from pubspec.yaml.
VERSION="$(grep -E '^version:' "$ROOT/app/pubspec.yaml" | head -1 | awk '{print $2}' | tr -d '\r')"
VERSION="${VERSION:-2.0.0}"
NAME="${VERSION%%+*}"

mkdir -p "$DEST_DIR"
# Remove older published APKs so only the newest is offered.
rm -f "$DEST_DIR"/*.apk 2>/dev/null || true

# Universal APK — the default download and the fallback for unknown ABIs.
cp "$UNIVERSAL_SRC" "$DEST_DIR/ping-${NAME}.apk"
SIZE="$(stat -c%s "$UNIVERSAL_SRC")"
SHA="$(sha256sum "$UNIVERSAL_SRC" | awk '{print $1}')"

# Per-ABI splits (optional): publish whichever ones were built.
VARIANTS_JSON=""
SPLIT_COUNT=0
for ABI in arm64-v8a armeabi-v7a x86_64; do
  SPLIT_SRC="$APK_SRC_DIR/app-${ABI}-release.apk"
  [ -f "$SPLIT_SRC" ] || continue
  cp "$SPLIT_SRC" "$DEST_DIR/ping-${NAME}-${ABI}.apk"
  VSIZE="$(stat -c%s "$SPLIT_SRC")"
  VSHA="$(sha256sum "$SPLIT_SRC" | awk '{print $1}')"
  ENTRY="\"${ABI}\": { \"file\": \"ping-${NAME}-${ABI}.apk\", \"size\": ${VSIZE}, \"sha256\": \"${VSHA}\" }"
  if [ -z "$VARIANTS_JSON" ]; then
    VARIANTS_JSON="    $ENTRY"
  else
    VARIANTS_JSON="${VARIANTS_JSON},
    $ENTRY"
  fi
  SPLIT_COUNT=$((SPLIT_COUNT + 1))
done

# versionCode = the integer after "+" in "<name>+<code>" (else null).
CODE="${VERSION##*+}"
if ! [[ "$CODE" =~ ^[0-9]+$ ]]; then CODE="null"; fi

cat > "$DEST_DIR/version.json" <<EOF
{
  "version": "${NAME}",
  "build": "${VERSION}",
  "versionCode": ${CODE},
  "file": "ping-${NAME}.apk",
  "size": ${SIZE},
  "sha256": "${SHA}",
  "publishedAt": $(date +%s000),
  "variants": {
${VARIANTS_JSON}
  }
}
EOF

echo "✅ Veröffentlicht: $DEST_DIR/ping-${NAME}.apk ($((SIZE/1024/1024)) MB universal)"
if [ "$SPLIT_COUNT" -gt 0 ]; then
  echo "   + $SPLIT_COUNT per-ABI Split(s)"
else
  echo "   (keine Splits gebaut — nur universal; für kleinere Updates: flutter build apk --split-per-abi --release)"
fi
echo "   Version $VERSION · versionCode $CODE · sha256 ${SHA:0:16}…"
