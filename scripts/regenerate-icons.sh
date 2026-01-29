#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(pwd)"
ICON_SVG="$REPO_ROOT/assets/icons/icon.svg"
ICONS_DIR="$REPO_ROOT/assets/icons"
ICONSET_DIR="$ICONS_DIR/icon.iconset"

if [[ ! -f "$ICON_SVG" ]]; then
  echo "Expected icon SVG not found: $ICON_SVG" >&2
  exit 1
fi

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "rsvg-convert is required but was not found on PATH" >&2
  exit 1
fi

NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-build)
      NO_BUILD=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$ICONS_DIR"

# Regenerate icon_<size>x<size>.png variants
for s in 16 32 48 64 128 256 512 1024; do
  rsvg-convert -w "$s" -h "$s" "$ICON_SVG" -o "$ICONS_DIR/icon_${s}x${s}.png"
done

# Regenerate macOS icon.iconset
mkdir -p "$ICONSET_DIR"

rsvg-convert -w 16 -h 16 "$ICON_SVG" -o "$ICONSET_DIR/icon_16x16.png"
rsvg-convert -w 32 -h 32 "$ICON_SVG" -o "$ICONSET_DIR/icon_16x16@2x.png"
rsvg-convert -w 32 -h 32 "$ICON_SVG" -o "$ICONSET_DIR/icon_32x32.png"
rsvg-convert -w 64 -h 64 "$ICON_SVG" -o "$ICONSET_DIR/icon_32x32@2x.png"
rsvg-convert -w 128 -h 128 "$ICON_SVG" -o "$ICONSET_DIR/icon_128x128.png"
rsvg-convert -w 256 -h 256 "$ICON_SVG" -o "$ICONSET_DIR/icon_128x128@2x.png"
rsvg-convert -w 256 -h 256 "$ICON_SVG" -o "$ICONSET_DIR/icon_256x256.png"
rsvg-convert -w 512 -h 512 "$ICON_SVG" -o "$ICONSET_DIR/icon_256x256@2x.png"
rsvg-convert -w 512 -h 512 "$ICON_SVG" -o "$ICONSET_DIR/icon_512x512.png"
rsvg-convert -w 1024 -h 1024 "$ICON_SVG" -o "$ICONSET_DIR/icon_512x512@2x.png"

# Regenerate icon.ico and icon.icns without keeping extra generated assets
TMP_DIR="$ICONS_DIR/.tmp-tauri-icon-output"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

npx tauri icon -o "$TMP_DIR" "$ICON_SVG" >/dev/null

if [[ ! -f "$TMP_DIR/icon.ico" ]]; then
  echo "tauri icon did not produce: $TMP_DIR/icon.ico" >&2
  exit 1
fi
if [[ ! -f "$TMP_DIR/icon.icns" ]]; then
  echo "tauri icon did not produce: $TMP_DIR/icon.icns" >&2
  exit 1
fi

cp "$TMP_DIR/icon.ico" "$ICONS_DIR/icon.ico"
cp "$TMP_DIR/icon.icns" "$ICONS_DIR/icon.icns"

if [[ "$NO_BUILD" -eq 0 ]]; then
  node build.js
fi
