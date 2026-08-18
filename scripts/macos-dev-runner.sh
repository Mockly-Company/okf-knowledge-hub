#!/usr/bin/env bash
set -euo pipefail

IDENTITY_NAME="${OKHUB_DEV_SIGNING_IDENTITY:-OkHub Local Development}"
BINARY="${1:?Cargo did not provide the development binary path}"
shift

IDENTITY_HASH="$({ security find-identity -v -p codesigning 2>/dev/null || true; } \
  | awk -v identity="$IDENTITY_NAME" 'index($0, "\"" identity "\"") { print $2; exit }')"

if [[ -z "$IDENTITY_HASH" ]]; then
  echo "OkHub 개발용 코드 서명 identity를 찾을 수 없습니다: $IDENTITY_NAME" >&2
  echo "먼저 pnpm dev:setup:macos 를 실행해 주세요." >&2
  exit 78
fi

codesign --force --sign "$IDENTITY_HASH" \
  --identifier com.okhub.desktop.dev \
  --timestamp=none \
  "$BINARY"
codesign --verify --strict --verbose=2 "$BINARY"

exec "$BINARY" "$@"
