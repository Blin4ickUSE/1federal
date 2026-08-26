#!/usr/bin/env bash
# Добавляет location /tbank в существующий nginx-конфиг (без переустановки).
# Использование на сервере из корня проекта:
#   sudo bash ensure-tbank-nginx.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_ok() { echo -e "${GREEN}$1${NC}"; }
log_warn() { echo -e "${YELLOW}$1${NC}"; }
log_err() { echo -e "${RED}$1${NC}" >&2; }

if [[ "$(id -u)" -ne 0 ]]; then
  log_err "Запустите с sudo: sudo bash ensure-tbank-nginx.sh"
  exit 1
fi

WEBHOOK_PORT=5000
if [[ -f .env ]]; then
  _port="$(grep -E '^WEBHOOK_PORT=' .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'")"
  if [[ -n "${_port}" ]]; then
    WEBHOOK_PORT="${_port}"
  fi
fi

TBANK_BLOCK=$(cat <<EOF
    location /tbank {
        proxy_pass http://127.0.0.1:${WEBHOOK_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
EOF
)

# Кандидаты: конфиги проекта + то, что указывает на webhook/miniapp
mapfile -t CANDIDATES < <(
  {
    ls -1 /etc/nginx/sites-available/*1federal* 2>/dev/null || true
    ls -1 /etc/nginx/sites-available/*federal* 2>/dev/null || true
    ls -1 /etc/nginx/sites-enabled/* 2>/dev/null || true
    find /etc/nginx/sites-available /etc/nginx/conf.d -type f \( -name '*.conf' -o -name '*' \) 2>/dev/null || true
  } | sort -u
)

patched=0
already=0

for conf in "${CANDIDATES[@]}"; do
  [[ -f "$conf" ]] || continue
  # Только файлы, где уже есть прокси на webhook (cloudpayments) или на :5000 / miniapp api
  if ! grep -qE 'cloudpayments|127\.0\.0\.1:5000|location /api' "$conf" 2>/dev/null; then
    continue
  fi
  # Нужен server с miniapp (не только panel): ищем cloudpayments или :9741
  if ! grep -qE 'cloudpayments|127\.0\.0\.1:9741|127\.0\.0\.1:5000' "$conf" 2>/dev/null; then
    continue
  fi

  if grep -qE 'location\s+/tbank\b' "$conf"; then
    log_ok "Уже есть /tbank: $conf"
    already=$((already + 1))
    continue
  fi

  backup="${conf}.bak.$(date +%Y%m%d%H%M%S)"
  cp -a "$conf" "$backup"
  log_warn "Бэкап: $backup"

  tmp="$(mktemp)"
  if grep -qE 'location\s+/cloudpayments\b' "$conf"; then
    # Вставить /tbank сразу перед /cloudpayments
    awk -v block="$TBANK_BLOCK" '
      /location[[:space:]]+\/cloudpayments/ && !done {
        print block
        print ""
        done=1
      }
      { print }
    ' "$conf" > "$tmp"
  elif grep -qE 'location\s+/api\b' "$conf"; then
    # После первого location /api { ... }
    awk -v block="$TBANK_BLOCK" '
      BEGIN { depth=0; in_api=0; done=0 }
      {
        if (!done && $0 ~ /location[[:space:]]+\/api([[:space:]]|\{)/) {
          in_api=1
        }
        if (in_api) {
          for (i=1; i<=length($0); i++) {
            c=substr($0,i,1)
            if (c=="{") depth++
            if (c=="}") {
              depth--
              if (depth<=0) {
                print
                print ""
                print block
                print ""
                in_api=0
                done=1
                next
              }
            }
          }
        }
        print
      }
    ' "$conf" > "$tmp"
  else
    log_warn "Пропуск (некуда вставить): $conf"
    rm -f "$tmp"
    continue
  fi

  if ! grep -qE 'location\s+/tbank\b' "$tmp"; then
    log_err "Не удалось вставить /tbank в $conf"
    rm -f "$tmp"
    continue
  fi

  mv "$tmp" "$conf"
  log_ok "Добавлен location /tbank → $conf"
  patched=$((patched + 1))
done

if [[ $patched -eq 0 && $already -eq 0 ]]; then
  log_err "Подходящий nginx-конфиг не найден. Добавьте вручную location /tbank → 127.0.0.1:${WEBHOOK_PORT}"
  exit 1
fi

if nginx -t; then
  systemctl reload nginx
  log_ok "✔ nginx перезагружен. Webhook: https://ДОМЕН/tbank"
else
  log_err "nginx -t failed — восстановите .bak и проверьте конфиг"
  exit 1
fi
