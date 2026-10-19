#!/usr/bin/env bash
# Exercises install.sh against a fake release served from a local HTTP server.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO_ROOT/install.sh"
VERSION="0.0.0-test"
TARGET="x86_64-unknown-linux-musl"
NAME="resonance-cli_${VERSION}_${TARGET}"

TMP=$(mktemp -d)
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

failures=0
pass() { printf '  ok   %s\n' "$1"; }
flunk() {
  printf '  FAIL %s\n' "$1"
  failures=$((failures + 1))
}
expect_message() {
  if [[ "$1" == *"$2"* ]]; then pass "$3"; else flunk "$3: $1"; fi
}

echo "Syntax"
if sh -n "$SCRIPT"; then pass "sh -n install.sh"; else flunk "sh -n install.sh"; fi
if command -v dash >/dev/null 2>&1; then
  if dash -n "$SCRIPT"; then pass "dash -n install.sh"; else flunk "dash -n install.sh"; fi
fi

echo "Fake release"
RELEASE="$TMP/release/v$VERSION"
mkdir -p "$TMP/stage/$NAME" "$RELEASE"
printf '#!/bin/sh\necho "resonance %s"\n' "$VERSION" > "$TMP/stage/$NAME/resonance"
chmod 755 "$TMP/stage/$NAME/resonance"
echo "readme" > "$TMP/stage/$NAME/README.md"
echo "license" > "$TMP/stage/$NAME/LICENSE"
tar -C "$TMP/stage" -czf "$RELEASE/$NAME.tar.gz" "$NAME"
printf '%s  %s\n' "$(sha256_of "$RELEASE/$NAME.tar.gz")" "$NAME.tar.gz" > "$RELEASE/SHA256SUMS"
cp "$RELEASE/SHA256SUMS" "$TMP/SHA256SUMS.good"

PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$TMP/release" >/dev/null 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:$PORT/v$VERSION/SHA256SUMS" >/dev/null 2>&1 && break
  sleep 0.1
done
export RESONANCE_RELEASE_BASE="http://127.0.0.1:$PORT"
export RESONANCE_TARGET="$TARGET"
pass "serving $RELEASE on port $PORT"

run_install() {
  local out
  if out=$(sh "$SCRIPT" "$@" 2>&1); then
    printf '%s' "$out"
    return 0
  else
    printf '%s' "$out"
    return 1
  fi
}

echo "Install"
if out=$(run_install --version "$VERSION" --dir "$TMP/bin"); then
  if [ -x "$TMP/bin/resonance" ] && [[ "$out" == *"Verified SHA-256 checksum"* ]] && [[ "$out" == *"resonance $VERSION"* ]]; then
    pass "installs a verified, working binary"
  else
    flunk "installs a verified, working binary: $out"
  fi
else
  flunk "installs a verified, working binary: $out"
fi
if [[ "$out" == *"is not on your PATH"* ]]; then
  pass "prints a PATH hint for a directory outside PATH"
else
  flunk "prints a PATH hint for a directory outside PATH"
fi

if out=$(run_install --version "v$VERSION" --dir "$TMP/bin-v"); then
  pass "accepts a v-prefixed version"
else
  flunk "accepts a v-prefixed version: $out"
fi

if out=$(RESONANCE_VERSION="$VERSION" RESONANCE_INSTALL_DIR="$TMP/bin-env" run_install) && [ -x "$TMP/bin-env/resonance" ]; then
  pass "takes version and directory from the environment"
else
  flunk "takes version and directory from the environment: $out"
fi

if out=$(run_install --version="$VERSION" --dir="$TMP/bin-eq"); then
  pass "accepts --option=value spelling"
else
  flunk "accepts --option=value spelling: $out"
fi

echo "Failures"
printf '%s  %s\n' "$(printf 'a%.0s' $(seq 1 64))" "$NAME.tar.gz" > "$RELEASE/SHA256SUMS"
if out=$(run_install --version "$VERSION" --dir "$TMP/bin-tampered"); then
  flunk "rejects a tampered checksum"
else
  if [[ "$out" == *"checksum mismatch"* ]] && [ ! -e "$TMP/bin-tampered/resonance" ]; then
    pass "rejects a tampered checksum and installs nothing"
  else
    flunk "rejects a tampered checksum and installs nothing: $out"
  fi
fi

: > "$RELEASE/SHA256SUMS"
if out=$(run_install --version "$VERSION" --dir "$TMP/bin-missing"); then
  flunk "rejects an archive missing from SHA256SUMS"
else
  expect_message "$out" "not listed in SHA256SUMS" "rejects an archive missing from SHA256SUMS"
fi
cp "$TMP/SHA256SUMS.good" "$RELEASE/SHA256SUMS"

if out=$(run_install --version "9.9.9" --dir "$TMP/bin-nover"); then
  flunk "fails on an unknown version"
else
  expect_message "$out" "download failed" "fails on an unknown version"
fi

if out=$(RESONANCE_TARGET=sparc-unknown-none run_install --version "$VERSION" --dir "$TMP/bin-target"); then
  flunk "rejects an unsupported target"
else
  expect_message "$out" "unsupported target" "rejects an unsupported target"
fi

mkdir -p "$TMP/readonly" && chmod 555 "$TMP/readonly"
if [ -w "$TMP/readonly" ]; then
  pass "skipped: unwritable directory check (running as root)"
elif out=$(run_install --version "$VERSION" --dir "$TMP/readonly"); then
  flunk "rejects an unwritable directory"
else
  expect_message "$out" "not writable" "rejects an unwritable directory"
fi
chmod 755 "$TMP/readonly"

if out=$(run_install --bogus); then
  flunk "rejects an unknown option"
else
  expect_message "$out" "unknown option" "rejects an unknown option"
fi

if out=$(sh "$SCRIPT" --help) && [[ "$out" == Usage:* ]]; then
  pass "prints usage"
else
  flunk "prints usage"
fi

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All install.sh checks passed"
