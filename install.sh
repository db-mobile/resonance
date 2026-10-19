#!/bin/sh
# Installs the Resonance command line (https://github.com/db-mobile/resonance).
#
#   curl -fsSL https://raw.githubusercontent.com/db-mobile/resonance/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/db-mobile/resonance/main/install.sh | sh -s -- --version 3.5.0 --dir ~/.local/bin
#
# Options and their environment equivalents:
#   --version X   RESONANCE_VERSION       release to install, "3.5.0" or "v3.5.0"; default: the latest release
#   --dir DIR     RESONANCE_INSTALL_DIR   where the binary goes; default: /usr/local/bin if writable, else ~/.local/bin
#                 RESONANCE_TARGET        override platform detection: x86_64-unknown-linux-musl,
#                                         aarch64-unknown-linux-musl or universal-apple-darwin
#                 RESONANCE_RELEASE_BASE  download base URL, for testing against a local mirror
#
# The archive is verified against the release's SHA256SUMS before anything is installed.
set -eu

REPO="db-mobile/resonance"
RELEASE_BASE="${RESONANCE_RELEASE_BASE:-https://github.com/$REPO/releases/download}"
LATEST_URL="https://github.com/$REPO/releases/latest"
VERSION="${RESONANCE_VERSION:-}"
INSTALL_DIR="${RESONANCE_INSTALL_DIR:-}"
TARGET="${RESONANCE_TARGET:-}"

usage() {
  cat <<EOF
Usage: install.sh [--version X] [--dir DIR]

  --version X   release to install (default: latest)
  --dir DIR     install directory (default: /usr/local/bin if writable, else ~/.local/bin)
  -h, --help    show this help

Environment: RESONANCE_VERSION, RESONANCE_INSTALL_DIR, RESONANCE_TARGET.
EOF
}

fail() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || fail "--version needs a value"
      VERSION="$2"
      shift 2
      ;;
    --version=*)
      VERSION="${1#--version=}"
      shift
      ;;
    --dir)
      [ $# -ge 2 ] || fail "--dir needs a value"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --dir=*)
      INSTALL_DIR="${1#--dir=}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1 (see --help)"
      ;;
  esac
done

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
  resolve_latest() { curl -fsSLI -o /dev/null -w '%{url_effective}' "$LATEST_URL"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q "$1" -O "$2"; }
  resolve_latest() {
    wget -q --max-redirect=5 --server-response -O /dev/null "$LATEST_URL" 2>&1 \
      | sed -n 's/^ *[Ll]ocation: *//p' | tail -n 1 | tr -d '\r'
  }
else
  fail "curl or wget is required"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
elif command -v openssl >/dev/null 2>&1; then
  sha256() { openssl dgst -sha256 "$1" | sed 's/.*= *//'; }
else
  fail "sha256sum, shasum or openssl is required to verify the download"
fi

VERSION="${VERSION#v}"
if [ -z "$VERSION" ]; then
  latest=$(resolve_latest) || fail "could not reach $LATEST_URL"
  case "$latest" in
    */tag/v*) VERSION="${latest##*/tag/v}" ;;
    *) fail "could not determine the latest release from $latest" ;;
  esac
fi

if [ -z "$TARGET" ]; then
  os=$(uname -s)
  arch=$(uname -m)
  case "$os/$arch" in
    Linux/x86_64 | Linux/amd64) TARGET=x86_64-unknown-linux-musl ;;
    Linux/aarch64 | Linux/arm64) TARGET=aarch64-unknown-linux-musl ;;
    Darwin/*) TARGET=universal-apple-darwin ;;
    *) fail "no prebuilt binary for $os/$arch; see https://github.com/$REPO/releases (Windows: use the .zip or the GitHub Action)" ;;
  esac
fi
case "$TARGET" in
  x86_64-unknown-linux-musl | aarch64-unknown-linux-musl | universal-apple-darwin) ;;
  *) fail "unsupported target $TARGET" ;;
esac

if [ -z "$INSTALL_DIR" ]; then
  if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    INSTALL_DIR=/usr/local/bin
  else
    INSTALL_DIR="$HOME/.local/bin"
  fi
fi
mkdir -p "$INSTALL_DIR" 2>/dev/null || fail "cannot create $INSTALL_DIR; pick another directory with --dir"
[ -w "$INSTALL_DIR" ] || fail "$INSTALL_DIR is not writable; use --dir <directory> or run the script with sudo"

NAME="resonance-cli_${VERSION}_${TARGET}"
ARCHIVE="$NAME.tar.gz"
BASE="$RELEASE_BASE/v$VERSION"

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t resonance)
trap 'rm -rf "$TMP"' EXIT INT TERM

printf 'Installing resonance %s (%s) to %s\n' "$VERSION" "$TARGET" "$INSTALL_DIR"
fetch "$BASE/$ARCHIVE" "$TMP/$ARCHIVE" || fail "download failed: $BASE/$ARCHIVE"
fetch "$BASE/SHA256SUMS" "$TMP/SHA256SUMS" || fail "download failed: $BASE/SHA256SUMS"

expected=$(grep -E "^[0-9a-fA-F]{64} [ *]$ARCHIVE\$" "$TMP/SHA256SUMS" | head -n 1 | cut -d ' ' -f 1 | tr 'A-F' 'a-f')
[ -n "$expected" ] || fail "$ARCHIVE is not listed in SHA256SUMS"
actual=$(sha256 "$TMP/$ARCHIVE" | tr 'A-F' 'a-f')
[ "$actual" = "$expected" ] || fail "checksum mismatch for $ARCHIVE (expected $expected, got $actual)"
printf 'Verified SHA-256 checksum\n'

tar -xzf "$TMP/$ARCHIVE" -C "$TMP"
[ -f "$TMP/$NAME/resonance" ] || fail "archive does not contain $NAME/resonance"
install -m 755 "$TMP/$NAME/resonance" "$INSTALL_DIR/resonance"
printf 'Installed %s\n' "$INSTALL_DIR/resonance"

# shellcheck disable=SC2016
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) printf 'Note: %s is not on your PATH; add it, e.g.  export PATH="%s:$PATH"\n' "$INSTALL_DIR" "$INSTALL_DIR" ;;
esac
"$INSTALL_DIR/resonance" --version
