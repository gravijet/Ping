#!/usr/bin/env bash
# Publish the latest Flutter release build(s) to the server's public download dir,
# so https://example.invalid/ serves the newest APK. Build first:
#   cd app
#   flutter build apk --release   # universal APK + per-ABI splits, one build
#   ../server/scripts/publish-apk.sh
#
# A single `flutter build apk --release` now emits the universal APK *and* the
# per-ABI splits (app-<abi>-release.apk), all on the same base version code,
# thanks to AGP's `splits { abi { … } }` block in android/app/build.gradle.kts.
# We deliberately no longer use `--split-per-abi`: that inflates each split's
# version code (base+1000·abi), which makes Android reject the universal as a
# downgrade on reinstall ("App nicht installiert"). Publishing the splits lets
# the in-app updater download only the slice for the user's CPU (~40% smaller).
#
# Every APK is verified against the version we are publishing using `aapt`: a
# split whose embedded versionName doesn't match the universal build is skipped
# rather than published. That guards against the classic mistake of leaving a
# previous release's split files in the build output and shipping them under the
# new version's name — which traps split-installed users in an endless
# "update available" loop because the "new" download is actually the old build.
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

# Read the version (e.g. 0.8.1+12) from pubspec.yaml.
VERSION="$(grep -E '^version:' "$ROOT/app/pubspec.yaml" | head -1 | awk '{print $2}' | tr -d '\r')"
VERSION="${VERSION:-0.0.0}"
NAME="${VERSION%%+*}"

# Locate aapt so we can read the real version metadata baked into each APK.
AAPT=""
for cand in aapt aapt2; do command -v "$cand" >/dev/null 2>&1 && { AAPT="$cand"; break; }; done
if [ -z "$AAPT" ] && [ -n "${ANDROID_HOME:-}" ]; then
  AAPT="$(ls "$ANDROID_HOME"/build-tools/*/aapt 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ -z "$AAPT" ] && [ -n "${ANDROID_SDK_ROOT:-}" ]; then
  AAPT="$(ls "$ANDROID_SDK_ROOT"/build-tools/*/aapt 2>/dev/null | sort -V | tail -1 || true)"
fi
[ -n "$AAPT" ] || echo "⚠️  aapt nicht gefunden — Splits werden ohne Versionsprüfung übernommen." >&2

# Echo "<versionCode> <versionName>" for an APK (empty if aapt is unavailable).
apk_badging() {
  [ -n "$AAPT" ] || return 0
  "$AAPT" dump badging "$1" 2>/dev/null \
    | grep -oE "versionCode='[0-9]+' versionName='[^']+'" \
    | sed -E "s/versionCode='([0-9]+)' versionName='([^']+)'/\1 \2/" | head -1
}

mkdir -p "$DEST_DIR"
# Remove older published APKs so only the newest is offered.
rm -f "$DEST_DIR"/*.apk 2>/dev/null || true

# Universal APK — the default download and the fallback for unknown ABIs.
cp "$UNIVERSAL_SRC" "$DEST_DIR/ping-${NAME}.apk"
SIZE="$(stat -c%s "$UNIVERSAL_SRC")"
SHA="$(sha256sum "$UNIVERSAL_SRC" | awk '{print $1}')"

# Archive this version's universal APK so old releases stay downloadable from
# their changelog entry (the rm above only clears the live dir, never archive/).
ARCHIVE_DIR="$DEST_DIR/archive"
mkdir -p "$ARCHIVE_DIR"
cp "$UNIVERSAL_SRC" "$ARCHIVE_DIR/ping-${NAME}.apk"

# Prefer the version code aapt reads from the universal APK over parsing the
# pubspec — it's the source of truth the device actually compares against.
U_CODE=""; U_NAME=""
read -r U_CODE U_NAME <<<"$(apk_badging "$UNIVERSAL_SRC")" || true
if [ -n "$U_NAME" ] && [ "$U_NAME" != "$NAME" ]; then
  echo "❌ Universelles APK ist v$U_NAME, pubspec sagt v$NAME — Build passt nicht zur Version." >&2
  exit 1
fi
CODE="${U_CODE:-${VERSION##*+}}"
if ! [[ "$CODE" =~ ^[0-9]+$ ]]; then CODE="null"; fi

# Per-ABI splits (optional): publish whichever ones were built *and verified*.
VARIANTS_JSON=""
SPLIT_COUNT=0
SKIPPED=0
for ABI in arm64-v8a armeabi-v7a x86_64; do
  SPLIT_SRC="$APK_SRC_DIR/app-${ABI}-release.apk"
  [ -f "$SPLIT_SRC" ] || continue
  VCODE=""; VNAME=""
  read -r VCODE VNAME <<<"$(apk_badging "$SPLIT_SRC")" || true
  # Refuse a split whose marketing version doesn't match what we're publishing.
  if [ -n "$VNAME" ] && [ "$VNAME" != "$NAME" ]; then
    echo "⚠️  Überspringe $ABI: APK ist v$VNAME, veröffentlicht wird v$NAME (veralteter Split)." >&2
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  cp "$SPLIT_SRC" "$DEST_DIR/ping-${NAME}-${ABI}.apk"
  VSIZE="$(stat -c%s "$SPLIT_SRC")"
  VSHA="$(sha256sum "$SPLIT_SRC" | awk '{print $1}')"
  CODE_FIELD=""
  [[ "$VCODE" =~ ^[0-9]+$ ]] && CODE_FIELD=", \"versionCode\": ${VCODE}"
  ENTRY="\"${ABI}\": { \"file\": \"ping-${NAME}-${ABI}.apk\", \"size\": ${VSIZE}, \"sha256\": \"${VSHA}\"${CODE_FIELD}, \"version\": \"${VNAME:-$NAME}\" }"
  if [ -z "$VARIANTS_JSON" ]; then
    VARIANTS_JSON="    $ENTRY"
  else
    VARIANTS_JSON="${VARIANTS_JSON},
    $ENTRY"
  fi
  SPLIT_COUNT=$((SPLIT_COUNT + 1))
done

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
  echo "   + $SPLIT_COUNT geprüfte(r) per-ABI Split(s)"
else
  echo "   (keine Splits veröffentlicht — nur universal; für kleinere Updates: flutter build apk --split-per-abi --release)"
fi
[ "$SKIPPED" -gt 0 ] && echo "   ⚠️  $SKIPPED Split(s) wegen Versions-Mismatch übersprungen — bitte neu bauen."
echo "   Version $VERSION · versionCode $CODE · sha256 ${SHA:0:16}…"
