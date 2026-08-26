#!/bin/sh
# Install Russian Trusted Root/Sub CA into the image trust store.
# Runs ONLY inside Docker build on the server — never on a developer workstation.
# Guide: https://developer.tbank.ru/eacq/intro/certificates/migration-russian-trusted-ca
set -eu

ROOT_URL="${RUSSIAN_TRUSTED_ROOT_URL:-https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer}"
SUB_URL="${RUSSIAN_TRUSTED_SUB_URL:-https://gu-st.ru/content/Other/doc/russian_trusted_sub_ca.cer}"
# PEM mirrors (if available)
ROOT_PEM_URL="${RUSSIAN_TRUSTED_ROOT_PEM_URL:-https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt}"
SUB_PEM_URL="${RUSSIAN_TRUSTED_SUB_PEM_URL:-https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt}"

TMP="${TMPDIR:-/tmp}/russian-trusted-ca.$$"
mkdir -p "$TMP"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  ca-certificates curl openssl >/dev/null
update-ca-certificates >/dev/null 2>&1 || true

to_pem() {
  src="$1"
  dst="$2"
  if openssl x509 -in "$src" -noout -text >/dev/null 2>&1; then
    openssl x509 -in "$src" -out "$dst"
  else
    openssl x509 -inform DER -in "$src" -out "$dst"
  fi
}

download() {
  url="$1"
  out="$2"
  curl -fsSL --connect-timeout 30 --retry 3 --retry-delay 2 "$url" -o "$out"
}

# Prefer PEM mirrors; fall back to .cer (PEM or DER)
if download "$ROOT_PEM_URL" "$TMP/root.raw" 2>/dev/null; then
  :
else
  download "$ROOT_URL" "$TMP/root.raw"
fi
if download "$SUB_PEM_URL" "$TMP/sub.raw" 2>/dev/null; then
  :
else
  download "$SUB_URL" "$TMP/sub.raw"
fi

to_pem "$TMP/root.raw" "$TMP/root.pem"
to_pem "$TMP/sub.raw" "$TMP/sub.pem"

# Sanity: subjects must match Russian Trusted CAs
openssl x509 -in "$TMP/root.pem" -noout -subject | grep -qi 'Russian Trusted Root CA'
openssl x509 -in "$TMP/sub.pem" -noout -subject | grep -qi 'Russian Trusted Sub CA'
openssl verify -CAfile "$TMP/root.pem" "$TMP/sub.pem" >/dev/null

install -d /usr/local/share/ca-certificates
install -m 0644 "$TMP/root.pem" /usr/local/share/ca-certificates/russian_trusted_root_ca.crt
install -m 0644 "$TMP/sub.pem" /usr/local/share/ca-certificates/russian_trusted_sub_ca.crt
update-ca-certificates

# Also append into certifi bundle (requests/httpx often use it)
if command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
  PY="$(command -v python3 || command -v python)"
  "$PY" - <<'PY'
import pathlib
try:
    import certifi
except ImportError:
    raise SystemExit(0)
bundle = pathlib.Path(certifi.where())
extra = (
    pathlib.Path("/usr/local/share/ca-certificates/russian_trusted_root_ca.crt").read_text(encoding="ascii")
    + "\n"
    + pathlib.Path("/usr/local/share/ca-certificates/russian_trusted_sub_ca.crt").read_text(encoding="ascii")
    + "\n"
)
text = bundle.read_text(encoding="ascii")
if "Russian Trusted Root CA" not in text:
    bundle.write_text(text.rstrip() + "\n" + extra, encoding="ascii")
    print("appended Russian Trusted CA to certifi:", bundle)
else:
    print("certifi already contains Russian Trusted CA")
PY
fi

# Combined bundle path used by env vars in Dockerfiles
cat /usr/local/share/ca-certificates/russian_trusted_root_ca.crt \
    /usr/local/share/ca-certificates/russian_trusted_sub_ca.crt \
    > /etc/ssl/certs/russian-trusted-ca-bundle.pem
chmod 0644 /etc/ssl/certs/russian-trusted-ca-bundle.pem

echo "Russian Trusted CA installed OK"
