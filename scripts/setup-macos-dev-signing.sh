#!/usr/bin/env bash
set -euo pipefail

IDENTITY_NAME="${OKHUB_DEV_SIGNING_IDENTITY:-OkHub Local Development}"
KEYCHAIN="${OKHUB_DEV_KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"

identity_hash() {
  local valid_only="${1:-false}"
  local args=(find-identity -p codesigning)
  if [[ "$valid_only" == "true" ]]; then
    args=(find-identity -v -p codesigning)
  fi
  security "${args[@]}" "$KEYCHAIN" 2>/dev/null \
    | awk -v identity="$IDENTITY_NAME" 'index($0, "\"" identity "\"") { print $2; exit }'
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "이 설정은 macOS에서만 필요합니다." >&2
  exit 64
fi

if [[ -n "$(identity_hash true)" ]]; then
  echo "OkHub 개발용 코드 서명 identity가 준비되어 있습니다: $IDENTITY_NAME"
  exit 0
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/okhub-signing.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
if [[ -n "$(identity_hash false)" ]]; then
  security find-certificate -c "$IDENTITY_NAME" -p "$KEYCHAIN" \
    > "$TMP_DIR/certificate.pem"
else
  PASSWORD="$(openssl rand -hex 24)"
  openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
    -keyout "$TMP_DIR/private-key.pem" \
    -out "$TMP_DIR/certificate.pem" \
    -days 3650 \
    -subj "/CN=$IDENTITY_NAME/O=OkHub Local Development" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=codeSigning"

  openssl pkcs12 -export \
    -inkey "$TMP_DIR/private-key.pem" \
    -in "$TMP_DIR/certificate.pem" \
    -name "$IDENTITY_NAME" \
    -out "$TMP_DIR/identity.p12" \
    -passout "pass:$PASSWORD"

  security import "$TMP_DIR/identity.p12" \
    -k "$KEYCHAIN" \
    -P "$PASSWORD" \
    -T /usr/bin/codesign
fi

echo "macOS가 표시하는 신뢰 설정 대화상자에서 현재 사용자 암호를 입력해 주세요."
security add-trusted-cert -r trustRoot -p codeSign \
  -k "$KEYCHAIN" "$TMP_DIR/certificate.pem"

if [[ -z "$(identity_hash true)" ]]; then
  echo "인증서를 가져왔지만 유효한 code-signing identity로 확인되지 않습니다." >&2
  exit 1
fi

echo "OkHub 개발용 코드 서명 identity를 생성했습니다: $IDENTITY_NAME"
