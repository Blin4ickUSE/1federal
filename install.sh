#!/usr/bin/env bash
set -Eeuo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'

log_info() { echo -e "${CYAN}$1${NC}"; }
log_warn() { echo -e "${YELLOW}$1${NC}"; }
log_success() { echo -e "${GREEN}$1${NC}"; }
log_error() { echo -e "${RED}$1${NC}" >&2; }

on_error() {
    log_error "Ошибка на строке $1. Установка прервана."
}
trap 'on_error $LINENO' ERR

prompt() {
    local message="$1"
    local __var="$2"
    local value
    read -r -p "$message" value < /dev/tty
    printf -v "$__var" '%s' "$value"
}

confirm() {
    local message="$1"
    local reply
    read -r -n1 -p "$message" reply < /dev/tty || true
    echo
    [[ "$reply" =~ ^[Yy]$ ]]
}

sanitize_domain() {
    local input="$1"
    echo "$input" \
        | sed -e 's%^https\?://%%' -e 's%/.*$%%' \
        | tr -cd 'A-Za-z0-9.-' \
        | tr '[:upper:]' '[:lower:]'
}

get_server_ip() {
    local ipv4_re='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
    local ip
    for url in \
        "https://api.ipify.org" \
        "https://ifconfig.co/ip" \
        "https://ipv4.icanhazip.com"; do
        ip=$(curl -fsS "$url" 2>/dev/null | tr -d '\r\n\t ')
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    done
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [[ $ip =~ $ipv4_re ]]; then
        echo "$ip"
    fi
}

resolve_domain_ip() {
    local domain="$1"
    local ipv4_re='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
    local ip
    ip=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | head -n1)
    if [[ $ip =~ $ipv4_re ]]; then
        echo "$ip"
        return 0
    fi
    if command -v dig >/dev/null 2>&1; then
        ip=$(dig +short A "$domain" 2>/dev/null | grep -E "$ipv4_re" | head -n1)
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    fi
    if command -v nslookup >/dev/null 2>&1; then
        ip=$(nslookup -type=A "$domain" 2>/dev/null | awk '/^Address: /{print $2; exit}')
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    fi
    return 1
}

ensure_packages() {
    log_info "\nШаг 1: проверка и установка системных зависимостей"
    declare -A packages=(
        [git]='git'
        [docker]='docker.io'
        [docker-compose]='docker-compose'
        [nginx]='nginx'
        [curl]='curl'
        [certbot]='certbot'
        [dig]='dnsutils'
    )
    local missing=()
    for cmd in "${!packages[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log_warn "Утилита '$cmd' не найдена. Будет установлен пакет '${packages[$cmd]}'."
            missing+=("${packages[$cmd]}")
        else
            log_success "✔ $cmd уже установлен."
        fi
    done
    if ((${#missing[@]} > 0)); then
        export DEBIAN_FRONTEND=noninteractive
        export DEBCONF_NONINTERACTIVE_SEEN=true
        sudo apt-get update
        sudo apt-get install -y --no-install-recommends "${missing[@]}"
        unset DEBIAN_FRONTEND
        unset DEBCONF_NONINTERACTIVE_SEEN
    else
        log_info "Все необходимые пакеты уже присутствуют."
    fi
}

ensure_services() {
    for service in docker nginx; do
        if ! sudo systemctl is-active --quiet "$service"; then
            log_warn "Сервис $service не запущен. Включаем и запускаем..."
            sudo systemctl enable "$service"
            sudo systemctl start "$service"
        else
            log_success "✔ Сервис $service активен."
        fi
    done
}

ensure_certbot_nginx() {
    log_info "\nПроверка плагина Certbot для Nginx"

    local has_nginx_plugin=0
    if command -v certbot >/dev/null 2>&1; then
        if certbot plugins 2>/dev/null | grep -qi 'nginx'; then
            has_nginx_plugin=1
        fi
    fi

    if [[ $has_nginx_plugin -eq 1 ]]; then
        log_success "✔ Плагин nginx для Certbot найден."
        return
    fi

    if command -v apt-get >/dev/null 2>&1; then
        log_info "Устанавливаю плагин python3-certbot-nginx (apt)..."
        export DEBIAN_FRONTEND=noninteractive
        export DEBCONF_NONINTERACTIVE_SEEN=true
        sudo apt-get update
        if sudo apt-get install -y --no-install-recommends python3-certbot-nginx; then
            if certbot plugins 2>/dev/null | grep -qi 'nginx'; then
                log_success "✔ Плагин nginx для Certbot установлен (apt)."
                unset DEBIAN_FRONTEND
                unset DEBCONF_NONINTERACTIVE_SEEN
                return
            fi
        fi
        unset DEBIAN_FRONTEND
        unset DEBCONF_NONINTERACTIVE_SEEN
    fi

    log_warn "Пробую установить Certbot (snap) с поддержкой nginx."
    if ! command -v snap >/dev/null 2>&1; then
        export DEBIAN_FRONTEND=noninteractive
        sudo apt-get update
        sudo apt-get install -y --no-install-recommends snapd
        unset DEBIAN_FRONTEND
    fi
    sudo snap install core || true
    sudo snap refresh core || true
    sudo snap install --classic certbot
    sudo ln -sf /snap/bin/certbot /usr/bin/certbot

    if certbot plugins 2>/dev/null | grep -qi 'nginx'; then
        log_success "✔ Плагин nginx для Certbot доступен (snap)."
        return
    fi

    log_error "Плагин nginx для Certbot недоступен."
    exit 1
}

configure_nginx() {
    local miniapp_domain="$1"
    local panel_domain="$2"
    local ssl_port="$3"
    local nginx_conf="$4"
    local nginx_link="$5"

    log_info "\nНастройка Nginx с SSL на порту ${ssl_port}"
    sudo rm -f /etc/nginx/sites-enabled/default
    
    sudo tee "$nginx_conf" >/dev/null <<EOF
server {
    listen ${ssl_port} ssl http2;
    listen [::]:${ssl_port} ssl http2;
    server_name ${miniapp_domain};

    ssl_certificate /etc/letsencrypt/live/${miniapp_domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${miniapp_domain}/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9741;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /cloudpayments {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen ${ssl_port} ssl http2;
    listen [::]:${ssl_port} ssl http2;
    server_name ${panel_domain};

    ssl_certificate /etc/letsencrypt/live/${panel_domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${panel_domain}/privkey.pem;

    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:9742;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

    sudo rm -f "$nginx_link"
    sudo ln -s "$nginx_conf" "$nginx_link"
    sudo nginx -t
    sudo systemctl reload nginx
    log_success "✔ Конфигурация Nginx обновлена."
}

create_env_file() {
    local domain="$1"
    local panel_domain="$2"
    local email="$3"
    local ssl_port="$4"
    local server_ip="${5:-}"
    
    log_info "\nЗаполнение переменных окружения:"
    
    prompt "Telegram Bot Token (основной бот): " TELEGRAM_BOT_TOKEN
    prompt "Telegram Admin ID: " TELEGRAM_ADMIN_ID
    
    log_info "\n${CYAN}Remnawave - панель управления VPN:${NC}"
    prompt "URL панели Remnawave (например https://panel.example.com): " REMWAVE_PANEL_URL_INPUT
    REMWAVE_PANEL_URL="${REMWAVE_PANEL_URL_INPUT:-http://localhost:3000}"
    prompt "API Token из панели Remnawave: " REMWAVE_API_KEY
    
    PANEL_SECRET=$(openssl rand -hex 32)
    log_info "Секретный ключ панели сгенерирован автоматически."

    local port_suffix=""
    if [[ "$ssl_port" != "443" ]]; then
        port_suffix=":${ssl_port}"
    fi
    
    cat > .env <<EOF
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_ADMIN_ID=${TELEGRAM_ADMIN_ID}

REMWAVE_PANEL_URL=${REMWAVE_PANEL_URL}
REMWAVE_API_KEY=${REMWAVE_API_KEY}

CLOUDPAYMENTS_PUBLIC_ID=
CLOUDPAYMENTS_API_SECRET=
CLOUDPAYMENTS_API_URL=https://api.cloudpayments.ru

PANEL_SECRET=${PANEL_SECRET}

MINIAPP_URL=https://${domain}${port_suffix}
PANEL_URL=https://${panel_domain}${port_suffix}
WEBHOOK_URL=https://${domain}${port_suffix}
API_URL=https://${domain}${port_suffix}/api

API_PORT=8000
WEBHOOK_PORT=5000
MINIAPP_PORT=9741
PANEL_PORT=9742
SSL_PORT=${ssl_port}

DB_PATH=data/data.db

SSL_EMAIL=${email}
PANEL_DOMAIN=${panel_domain}
MINIAPP_DOMAIN=${domain}
WEBHOOK_DOMAIN=${domain}

MAIL_DOMAIN=${domain}
MAIL_FROM=no-reply@${domain}
SMTP_HOST=mail
SMTP_PORT=25
EOF

    log_success "✔ Файл .env создан."
    log_warn "\n⚠️  CloudPayments настраивается в панели управления:"
    log_warn "   https://${panel_domain}${port_suffix}"
    log_info "\nПочта (OTP): письма уходят с no-reply@${domain}"
    if [[ -n "$server_ip" ]]; then
        log_info "DNS для доставки писем (домен ${domain}):"
        log_info "  1) SPF — TXT-запись на @ (или ${domain}):"
        log_info "       v=spf1 ip4:${server_ip} ~all"
        log_info "  2) PTR (обратная зона) — у хостера VPS для IP ${server_ip}:"
        log_info "       укажите hostname ${domain}"
        log_info "       и A-запись ${domain} → ${server_ip} уже должна совпадать (иначе многие почтовики режут)."
    else
        log_info "DNS для писем: SPF TXT @  →  v=spf1 ip4:ВАШ_IP_СЕРВЕРА ~all"
        log_info "PTR у хостера для IP сервера → hostname ${domain} (и A ${domain} → тот же IP)."
    fi
}

REPO_URL="https://github.com/Blin4ickUSE/1federal.git"
REPO_BRANCH="2.0"
PROJECT_DIR="1federal"
NGINX_CONF="/etc/nginx/sites-available/${PROJECT_DIR}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${PROJECT_DIR}.conf"

SSL_PORT=8443

log_success "--- Запуск скрипта установки/обновления 1FEDERAL VPN ---"

if [[ -f "$NGINX_CONF" ]]; then
    log_info "\nОбнаружена существующая конфигурация. Запускается режим обновления."
    if [[ ! -d "$PROJECT_DIR" ]]; then
        log_error "Конфигурация Nginx найдена, но каталог '${PROJECT_DIR}' отсутствует. Удалите $NGINX_CONF и повторите установку."
        exit 1
    fi
    cd "$PROJECT_DIR"
    log_info "\nШаг 1: обновление исходного кода (ветка ${REPO_BRANCH})"
    git fetch origin "$REPO_BRANCH"
    git checkout "$REPO_BRANCH"
    git pull --ff-only origin "$REPO_BRANCH"
    log_success "✔ Репозиторий обновлён."
    log_info "\nШаг 2: пересборка и перезапуск контейнеров"
    sudo docker-compose down --remove-orphans
    sudo docker-compose up -d --build
    log_success "\n🎉 Обновление успешно завершено!"
    exit 0
fi

log_info "\nСуществующая конфигурация не найдена. Запускается новая установка."

ensure_packages
ensure_services
ensure_certbot_nginx

log_info "\nШаг 2: клонирование репозитория (${REPO_BRANCH})"
log_info "Источник: https://github.com/Blin4ickUSE/1federal/tree/${REPO_BRANCH}"
if [[ ! -d "$PROJECT_DIR/.git" ]]; then
    git clone -b "$REPO_BRANCH" --single-branch "$REPO_URL" "$PROJECT_DIR"
else
    log_warn "Каталог $PROJECT_DIR уже существует. Будет использована текущая версия."
fi
cd "$PROJECT_DIR"
log_success "✔ Репозиторий 1FEDERAL VPN готов."

log_info "\nШаг 3: настройка домена и SSL"

prompt "Введите домен для мини-приложения (например, app.example.com): " USER_DOMAIN_INPUT
DOMAIN=$(sanitize_domain "$USER_DOMAIN_INPUT")
if [[ -z "$DOMAIN" ]]; then
    log_error "Некорректное доменное имя. Установка прервана."
    exit 1
fi

prompt "Введите домен для панели управления (например, panel.example.com): " USER_PANEL_DOMAIN_INPUT
PANEL_DOMAIN=$(sanitize_domain "$USER_PANEL_DOMAIN_INPUT")
if [[ -z "$PANEL_DOMAIN" ]]; then
    log_error "Некорректное доменное имя для панели. Установка прервана."
    exit 1
fi

prompt "Введите email для Let's Encrypt: " EMAIL
if [[ -z "$EMAIL" ]]; then
    log_error "Email обязателен для выпуска сертификата."
    exit 1
fi

prompt "SSL порт (по умолчанию 8443, введите 443 если порт свободен): " SSL_PORT_INPUT
SSL_PORT="${SSL_PORT_INPUT:-8443}"

SERVER_IP=$(get_server_ip || true)
DOMAIN_IP=$(resolve_domain_ip "$DOMAIN" || true)
PANEL_DOMAIN_IP=$(resolve_domain_ip "$PANEL_DOMAIN" || true)

if [[ -n "$SERVER_IP" ]]; then
    log_info "IP сервера: ${SERVER_IP}"
fi

if [[ -n "$DOMAIN_IP" ]]; then
    log_info "IP домена ${DOMAIN}: ${DOMAIN_IP}"
fi

if [[ -n "$PANEL_DOMAIN_IP" ]]; then
    log_info "IP домена панели ${PANEL_DOMAIN}: ${PANEL_DOMAIN_IP}"
fi

if [[ -n "$SERVER_IP" && -n "$DOMAIN_IP" && "$SERVER_IP" != "$DOMAIN_IP" ]]; then
    log_warn "DNS-запись домена ${DOMAIN} не совпадает с IP этого сервера."
    if ! confirm "Продолжить установку? (y/n): "; then
        exit 1
    fi
fi

if [[ -n "$SERVER_IP" && -n "$PANEL_DOMAIN_IP" && "$SERVER_IP" != "$PANEL_DOMAIN_IP" ]]; then
    log_warn "DNS-запись домена панели ${PANEL_DOMAIN} не совпадает с IP этого сервера."
    if ! confirm "Продолжить установку? (y/n): "; then
        exit 1
    fi
fi

if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q 'Status: active'; then
    log_warn "Обнаружен активный UFW. Открываем порты 80 и ${SSL_PORT}."
    sudo ufw allow 80/tcp
    sudo ufw allow ${SSL_PORT}/tcp
fi

log_info "\nПолучение SSL сертификатов..."

TEMP_CONF="/tmp/1federal_certbot.conf"
sudo tee "$TEMP_CONF" >/dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    location / {
        return 301 https://\$host:${SSL_PORT}\$request_uri;
    }
}
server {
    listen 80;
    server_name ${PANEL_DOMAIN};
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    location / {
        return 301 https://\$host:${SSL_PORT}\$request_uri;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo rm -f "$NGINX_LINK"
sudo ln -sf "$TEMP_CONF" "$NGINX_LINK"
sudo nginx -t && sudo systemctl reload nginx

sudo mkdir -p /var/www/html/.well-known/acme-challenge

if [[ -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
    log_success "✔ SSL-сертификаты для ${DOMAIN} уже существуют."
else
    log_info "Получение SSL-сертификатов для ${DOMAIN}..."
    sudo certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive
    log_success "✔ Сертификаты Let's Encrypt для ${DOMAIN} успешно получены."
fi

if [[ -d "/etc/letsencrypt/live/${PANEL_DOMAIN}" ]]; then
    log_success "✔ SSL-сертификаты для ${PANEL_DOMAIN} уже существуют."
else
    log_info "Получение SSL-сертификатов для ${PANEL_DOMAIN}..."
    sudo certbot certonly --webroot -w /var/www/html -d "$PANEL_DOMAIN" --email "$EMAIL" --agree-tos --non-interactive
    log_success "✔ Сертификаты Let's Encrypt для ${PANEL_DOMAIN} успешно получены."
fi

sudo rm -f "$TEMP_CONF"

log_info "\nШаг 4: настройка Nginx"
configure_nginx "$DOMAIN" "$PANEL_DOMAIN" "$SSL_PORT" "$NGINX_CONF" "$NGINX_LINK"

log_info "\nШаг 5: настройка переменных окружения (.env)"

if [[ -f ".env" ]]; then
    log_warn "Файл .env уже существует."
    if ! confirm "Перезаписать существующий .env? (y/n): "; then
        log_info "Используется существующий .env файл."
    else
        create_env_file "$DOMAIN" "$PANEL_DOMAIN" "$EMAIL" "$SSL_PORT" "$SERVER_IP"
    fi
else
    create_env_file "$DOMAIN" "$PANEL_DOMAIN" "$EMAIL" "$SSL_PORT" "$SERVER_IP"
fi

log_info "\nШаг 6: подготовка директорий и запуск Docker-контейнеров"
mkdir -p data
chmod 755 data

if [[ -n "$(sudo docker-compose ps -q 2>/dev/null)" ]]; then
    sudo docker-compose down
fi
sudo docker-compose up -d --build

PORT_SUFFIX=""
if [[ "$SSL_PORT" != "443" ]]; then
    PORT_SUFFIX=":${SSL_PORT}"
fi

cat <<SUMMARY

${GREEN}🎉 ${BOLD}Установка 1FEDERAL VPN завершена!${NC} 🎉

${BOLD}Мини-приложение:${NC}
  ${YELLOW}https://${DOMAIN}${PORT_SUFFIX}${NC}

${BOLD}Веб‑панель:${NC}
  ${YELLOW}https://${PANEL_DOMAIN}${PORT_SUFFIX}${NC}

${BOLD}Webhooks:${NC}
  CloudPayments:  ${YELLOW}https://${DOMAIN}${PORT_SUFFIX}/cloudpayments${NC}

${BOLD}Почта (OTP):${NC}
  From: no-reply@${DOMAIN}
  SPF TXT @ : v=spf1 ip4:${SERVER_IP:-YOUR_SERVER_IP} ~all
  PTR у хостера для IP ${SERVER_IP:-YOUR_SERVER_IP} -> hostname ${DOMAIN}
  (A-запись ${DOMAIN} должна указывать на тот же IP)

SUMMARY