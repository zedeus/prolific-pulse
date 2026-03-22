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

XPI_PATH="$DIST_DIR/${NAME}.xpi"

# Remove old build if present
rm -f "$XPI_PATH"

# Package extension (XPI is just a ZIP with .xpi extension)
cd "$EXT_DIR"
zip -r -FS "$XPI_PATH" . \
  -x "*.git*" \
  -x "*.xpi" \
  -x "*.zip" \
  -x "*.svg" \
  -x ".DS_Store" \
  -x "Thumbs.db" \
  -x "README.md"

echo ""
echo "Built: $XPI_PATH"
echo "Size:  $(du -h "$XPI_PATH" | cut -f1)"
