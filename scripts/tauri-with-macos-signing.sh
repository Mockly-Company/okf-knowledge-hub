#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI="$ROOT/node_modules/.bin/tauri"

# Tauri build scripts persist absolute permission paths in Cargo output.
# A stable project-level target keeps those paths valid when a worktree moves.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${OKHUB_CARGO_TARGET_DIR:-$HOME/.cargo/targets/okhub}}"

if [[ "$(uname -s)" != "Darwin" || "${1:-}" != "dev" ]]; then
  exec "$TAURI" "$@"
fi

IDENTITY_NAME="${OKHUB_DEV_SIGNING_IDENTITY:-OkHub Local Development}"
IDENTITY_HASH="$({ security find-identity -v -p codesigning 2>/dev/null || true; } \
  | awk -v identity="$IDENTITY_NAME" 'index($0, "\"" identity "\"") { print $2; exit }')"
if [[ -z "$IDENTITY_HASH" ]]; then
  echo "OkHub 개발용 코드 서명 identity를 찾을 수 없습니다: $IDENTITY_NAME" >&2
  echo "먼저 pnpm dev:setup:macos 를 실행해 주세요." >&2
  exit 78
fi

RUNNER="$ROOT/scripts/macos-dev-runner.sh"
HOST="$(rustc -vV | awk '/^host:/ { print $2 }')"
case "$HOST" in
  aarch64-apple-darwin)
    export CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER="$RUNNER"
    ;;
  x86_64-apple-darwin)
    export CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER="$RUNNER"
    ;;
  *)
    echo "지원하지 않는 macOS Rust host입니다: $HOST" >&2
    exit 78
    ;;
esac

exec "$TAURI" "$@"
