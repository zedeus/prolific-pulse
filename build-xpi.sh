#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/extension"
DIST_DIR="$SCRIPT_DIR/dist"

# Read version from manifest.json
VERSION=$(grep -o '"version": *"[^"]*"' "$EXT_DIR/manifest.json" | head -1 | grep -o '"[^"]*"$' | tr -d '"')
if [ -z "$VERSION" ]; then
  echo "Error: could not read version from manifest.json" >&2
  exit 1
fi
NAME="prolific-pulse-${VERSION}"

mkdir -p "$DIST_DIR"

COMMON_EXCLUDES=(
  -x "*.git*"
  -x "*.xpi"
  -x "*.zip"
  -x "*.svg"
  -x ".DS_Store"
  -x "Thumbs.db"
  -x "README.md"
)

# --- Firefox XPI ---
XPI_PATH="$DIST_DIR/${NAME}.xpi"
rm -f "$XPI_PATH"

cd "$EXT_DIR"
zip -r -FS "$XPI_PATH" . \
  "${COMMON_EXCLUDES[@]}" \
  -x "manifest.chrome.json"

echo ""
echo "Firefox: $XPI_PATH ($(du -h "$XPI_PATH" | cut -f1))"

# --- Chrome ZIP ---
CHROME_PATH="$DIST_DIR/${NAME}-chrome.zip"
rm -f "$CHROME_PATH"

CHROME_TMP=$(mktemp -d)
trap 'rm -rf "$CHROME_TMP"' EXIT

cp -r "$EXT_DIR"/* "$CHROME_TMP/"
rm -f "$CHROME_TMP/manifest.json"
mv "$CHROME_TMP/manifest.chrome.json" "$CHROME_TMP/manifest.json"

cd "$CHROME_TMP"
zip -r -FS "$CHROME_PATH" . \
  "${COMMON_EXCLUDES[@]}"

echo "Chrome:  $CHROME_PATH ($(du -h "$CHROME_PATH" | cut -f1))"
