#!/usr/bin/env bash
# Нормальная настройка nginx для CloudPayments.
#
#   location /cloudpayments → webhook :5000
#   удаляет устаревший /platega
#
# На сервере:
#   sudo bash scripts/fix-nginx-cloudpayments.sh
#   docker compose up -d --build webhook
#
# В ЛК CloudPayments:
#   Pay:  https://app.1federal.one/cloudpayments/pay
#   Fail: https://app.1federal.one/cloudpayments/fail

set -euo pipefail

WEBHOOK_PORT="${WEBHOOK_PORT:-5000}"
DOMAIN="${1:-app.1federal.one}"

mapfile -t CANDIDATES < <(
  find /etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/conf.d \
    -type f 2>/dev/null | sort -u
)

TARGET=""
for conf in "${CANDIDATES[@]}"; do
  if grep -qE "server_name[^;]*${DOMAIN}|proxy_pass http://127.0.0.1:9741" "$conf" 2>/dev/null; then
    TARGET="$conf"
    break
  fi
done

if [[ -z "$TARGET" ]]; then
  echo "Не найден nginx-конфиг для ${DOMAIN}"
  exit 1
fi

echo "Конфиг: $TARGET"
cp -a "$TARGET" "${TARGET}.bak.$(date +%Y%m%d%H%M%S)"

python3 - "$TARGET" "$WEBHOOK_PORT" <<'PY'
import re
import sys

path, port = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()


def strip_location(src: str, name: str) -> str:
    """Удалить location /name { ... } (простые блоки без вложенных location)."""
    pattern = re.compile(
        rf"\n[ \t]*location[ \t]+(?:=[ \t]+)?/?{re.escape(name)}[^\n]*\{{.*?\n[ \t]*\}}",
        re.S,
    )
    return pattern.sub("", src)


text = strip_location(text, "platega")
text = strip_location(text, "cloudpayments")

block = f"""
    location /cloudpayments {{
        proxy_pass http://127.0.0.1:{port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}
"""

if "location /cloudpayments" not in text:
    m = re.search(r"location[ \t]+/api[ \t\n]*\{.*?\n[ \t]*\}", text, flags=re.S)
    if m:
        text = text[: m.end()] + "\n" + block + text[m.end() :]
    else:
        idx = text.rfind("}")
        if idx < 0:
            raise SystemExit("Не найден закрывающий brace в nginx-конфиге")
        text = text[:idx] + block + "\n" + text[idx:]

open(path, "w", encoding="utf-8").write(text)
print("OK written", path)
PY

nginx -t
systemctl reload nginx

echo
echo "nginx OK. Проверка:"
echo "  curl -sS https://${DOMAIN}/cloudpayments/pay"
echo
echo "ЛК CloudPayments:"
echo "  Pay:  https://${DOMAIN}/cloudpayments/pay"
echo "  Fail: https://${DOMAIN}/cloudpayments/fail"
echo
echo "Пересобери webhook:"
echo "  docker compose up -d --build webhook"
