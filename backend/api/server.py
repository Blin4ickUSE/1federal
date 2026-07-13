import os
import logging
import hmac
import hashlib
import secrets
import json
from datetime import datetime, timedelta
from urllib.parse import parse_qs, unquote
from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
import requests
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../'))
from backend.database import database
from backend.core import core, abuse_detected
from backend.api import remnawave, platega
app = Flask(__name__)
CORS(app, resources={'/api/*': {'origins': '*'}})
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
ENV_KEYS_MANAGED = {'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_ID', 'TELEGRAM_ADMIN_IDS', 'REMWAVE_PANEL_URL', 'REMWAVE_API_KEY', 'PLATEGA_MERCHANT_ID', 'PLATEGA_SECRET_KEY', 'TRIAL_HOURS'}

def _parse_admin_ids() -> list[int]:
    raw = os.getenv('TELEGRAM_ADMIN_IDS') or os.getenv('TELEGRAM_ADMIN_ID', '')
    ids = []
    for part in str(raw).replace(';', ',').split(','):
        part = part.strip()
        if not part:
            continue
        try:
            ids.append(int(part))
        except ValueError:
            continue
    return list(dict.fromkeys(ids))

def _get_client_ip() -> str:
    forwarded = request.headers.get('X-Forwarded-For', '').strip()
    if forwarded:
        return forwarded.split(',')[0].strip()
    return (request.remote_addr or '').strip()

def _telegram_api(token: str, method: str, payload: dict, files: dict | None=None) -> dict | None:
    url = f'https://api.telegram.org/bot{token}/{method}'
    try:
        if files:
            resp = requests.post(url, data=payload, files=files, timeout=60)
        else:
            resp = requests.post(url, json=payload, timeout=20)
        data = resp.json()
        if resp.status_code == 200 and data.get('ok'):
            return data.get('result')
    except Exception as e:
        logger.error('Telegram API %s failed: %s', method, e)
    return None

def _load_env_map(env_path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    if not os.path.exists(env_path):
        return values
    with open(env_path, 'r', encoding='utf-8') as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    return values

def _save_env_map(env_path: str, updates: dict[str, str]) -> None:
    existing_lines: list[str] = []
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            existing_lines = f.read().splitlines()
    changed = set()
    out_lines: list[str] = []
    for line in existing_lines:
        if '=' in line and (not line.strip().startswith('#')):
            key = line.split('=', 1)[0].strip()
            if key in updates:
                out_lines.append(f'{key}={updates[key]}')
                changed.add(key)
                continue
        out_lines.append(line)
    for key, value in updates.items():
        if key not in changed:
            out_lines.append(f'{key}={value}')
    with open(env_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(out_lines).rstrip() + '\n')

def format_datetime_msk(dt: datetime=None) -> str:
    if dt is None:
        dt = datetime.now()
    return dt.strftime('%Y-%m-%dT%H:%M:%S')
PANEL_SECRET = os.getenv('PANEL_SECRET', '')
BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN') or os.getenv('BOT_TOKEN', '')

def verify_telegram_webapp_data(init_data: str) -> dict | None:
    if not init_data or not BOT_TOKEN:
        return None
    try:
        parsed = parse_qs(init_data)
        received_hash = parsed.get('hash', [''])[0]
        if not received_hash:
            return None
        data_check_arr = []
        for key, value in parsed.items():
            if key != 'hash':
                data_check_arr.append(f'{key}={value[0]}')
        data_check_arr.sort()
        data_check_string = '\n'.join(data_check_arr)
        secret_key = hmac.new(b'WebAppData', BOT_TOKEN.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calculated_hash, received_hash):
            return None
        import json
        user_data_str = parsed.get('user', [''])[0]
        if user_data_str:
            user_data = json.loads(unquote(user_data_str))
            return user_data
        return None
    except Exception as e:
        logger.error(f'Error verifying Telegram WebApp data: {e}')
        return None

def verify_telegram_login_widget(data: dict) -> dict | None:
    if not data or not BOT_TOKEN:
        return None
    try:
        received_hash = data.get('hash')
        if not received_hash:
            return None
        auth_date = data.get('auth_date')
        if auth_date is None:
            return None
        try:
            auth_ts = int(auth_date)
        except (TypeError, ValueError):
            return None
        if datetime.utcnow().timestamp() - auth_ts > 86400:
            return None
        data_check_arr = []
        for key in sorted(data.keys()):
            if key == 'hash':
                continue
            value = data[key]
            if value is None or value == '':
                continue
            data_check_arr.append(f'{key}={value}')
        data_check_string = '\n'.join(data_check_arr)
        secret_key = hashlib.sha256(BOT_TOKEN.encode()).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calculated_hash, received_hash):
            return None
        user_id = data.get('id')
        if user_id is None:
            return None
        return {'id': int(user_id), 'first_name': data.get('first_name'), 'last_name': data.get('last_name'), 'username': data.get('username'), 'photo_url': data.get('photo_url'), 'auth_date': auth_ts}
    except Exception as e:
        logger.error(f'Error verifying Telegram Login Widget data: {e}')
        return None

def get_telegram_user_from_request() -> dict | None:
    init_data = request.headers.get('X-Telegram-Init-Data', '')
    if init_data:
        user = verify_telegram_webapp_data(init_data)
        if user:
            return user
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:].strip()
        if token:
            session = database.verify_miniapp_session(token)
            if session:
                return {'id': session['telegram_id'], 'username': session.get('username'), 'first_name': session.get('first_name'), 'photo_url': session.get('photo_url')}
    return None

def assert_telegram_identity(telegram_id: int):
    tg_user = get_telegram_user_from_request()
    if not tg_user:
        return (jsonify({'error': 'Unauthorized'}), 401)
    try:
        auth_tid = int(tg_user.get('id', 0))
    except (TypeError, ValueError):
        return (jsonify({'error': 'Unauthorized'}), 401)
    if auth_tid != int(telegram_id):
        return (jsonify({'error': 'Forbidden'}), 403)
    return None

def require_telegram_auth(allow_user_id: bool=False):
    def decorator(f):
        def wrapper(*args, **kwargs):
            tg_user = get_telegram_user_from_request()
            if not tg_user:
                pass
            kwargs['_tg_user'] = tg_user
            return f(*args, **kwargs)
        wrapper.__name__ = f.__name__
        return wrapper
    return decorator

def require_auth(f):
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return (jsonify({'error': 'Unauthorized'}), 401)
        if not auth_header.startswith('Bearer '):
            return (jsonify({'error': 'Invalid authorization format'}), 401)
        token = auth_header[7:]
        if token == PANEL_SECRET:
            return f(*args, **kwargs)
        session = database.verify_panel_session(token)
        if session:
            return f(*args, **kwargs)
        return (jsonify({'error': 'Unauthorized'}), 401)
    wrapper.__name__ = f.__name__
    return wrapper

@app.route('/api/encrypt-link', methods=['POST'])

def encrypt_link_for_happ():
    import requests as req
    data = request.get_json()
    url = data.get('url') if data else None
    if not url:
        return (jsonify({'error': 'URL is required'}), 400)
    try:
        response = req.post('https://crypto.happ.su/api.php', json={'url': url}, headers={'Content-Type': 'application/json'}, timeout=10)
        if response.ok:
            result = response.json()
            if result and result.get('encrypted_link'):
                return jsonify({'encrypted_link': result['encrypted_link']})
        logger.error(f'Happ encryption API failed: {response.status_code} - {response.text}')
        return (jsonify({'error': 'Encryption failed'}), 500)
    except Exception as e:
        logger.error(f'Happ encryption API error: {e}')
        return (jsonify({'error': str(e)}), 500)

@app.route('/api/redirect')

def redirect_to_happ():
    from flask import Response
    url = request.args.get('url', '')
    url_js = json.dumps(url)
    html = (
        '<!DOCTYPE html>\n'
        '<html lang="ru">\n'
        '<head>\n'
        '    <meta charset="UTF-8">\n'
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        '    <title>Открываем Happ...</title>\n'
        '    <style>\n'
        '        * { margin: 0; padding: 0; box-sizing: border-box; }\n'
        '        body {\n'
        "            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n"
        '            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);\n'
        '            min-height: 100vh;\n'
        '            display: flex;\n'
        '            align-items: center;\n'
        '            justify-content: center;\n'
        '            color: #fff;\n'
        '        }\n'
        '        @media (prefers-color-scheme: light) {\n'
        '            body {\n'
        '                background: linear-gradient(135deg, #f5f5f7 0%, #e5e7eb 100%);\n'
        '                color: #1d1d1f;\n'
        '            }\n'
        '            .spinner {\n'
        '                border-color: rgba(0,0,0,0.1);\n'
        '                border-top-color: #3b82f6;\n'
        '            }\n'
        '            .error {\n'
        '                background: rgba(0,0,0,0.05);\n'
        '            }\n'
        '            .btn {\n'
        '                background: #3b82f6;\n'
        '                color: #fff;\n'
        '            }\n'
        '        }\n'
        '        .container { text-align: center; padding: 2rem; }\n'
        '        .spinner {\n'
        '            width: 48px;\n'
        '            height: 48px;\n'
        '            border: 4px solid rgba(255,255,255,0.2);\n'
        '            border-top-color: #fff;\n'
        '            border-radius: 50%;\n'
        '            animation: spin 1s linear infinite;\n'
        '            margin: 0 auto 1.5rem;\n'
        '        }\n'
        '        @keyframes spin { to { transform: rotate(360deg); } }\n'
        '        h1 { font-size: 1.25rem; font-weight: 500; margin-bottom: 0.5rem; }\n'
        '        p { font-size: 0.875rem; opacity: 0.7; }\n'
        '        .error {\n'
        '            display: none;\n'
        '            margin-top: 1.5rem;\n'
        '            padding: 1rem;\n'
        '            background: rgba(255,255,255,0.1);\n'
        '            border-radius: 8px;\n'
        '        }\n'
        '        .error.show { display: block; }\n'
        '        .btn {\n'
        '            display: inline-block;\n'
        '            margin-top: 1rem;\n'
        '            padding: 0.75rem 1.5rem;\n'
        '            background: #fff;\n'
        '            color: #1a1a2e;\n'
        '            text-decoration: none;\n'
        '            border-radius: 8px;\n'
        '            font-weight: 500;\n'
        '        }\n'
        '    </style>\n'
        '</head>\n'
        '<body>\n'
        '    <div class="container">\n'
        '        <div class="spinner" id="spinner"></div>\n'
        '        <h1 id="title">Открываем приложение...</h1>\n'
        '        <p id="subtitle">Пожалуйста, подождите</p>\n'
        '        <div class="error" id="errorBlock">\n'
        '            <p>Если приложение не открылось, нажмите кнопку:</p>\n'
        '            <a class="btn" id="manualBtn" href="#">Открыть приложение</a>\n'
        '        </div>\n'
        '    </div>\n'
        '    <script>\n'
        '        (function() {\n'
        f'            var url = {url_js};\n'
        '            if (!url) {\n'
        "                document.getElementById('title').textContent = 'URL не указан';\n"
        "                document.getElementById('subtitle').textContent = '';\n"
        "                document.getElementById('spinner').style.display = 'none';\n"
        '                return;\n'
        '            }\n'
        "            var manualBtn = document.getElementById('manualBtn');\n"
        '            manualBtn.href = url;\n'
        '            window.location.href = url;\n'
        '            setTimeout(function() {\n'
        "                document.getElementById('errorBlock').classList.add('show');\n"
        '            }, 2000);\n'
        '        })();\n'
        '    </script>\n'
        '</body>\n'
        '</html>'
    )
    return Response(html, mimetype='text/html')

@app.route('/api/auth/telegram-login', methods=['POST'])

def miniapp_telegram_login():
    data = request.json or {}
    tg_user = verify_telegram_login_widget(data)
    if not tg_user:
        return (jsonify({'error': 'Недействительные данные авторизации Telegram'}), 401)
    telegram_id = int(tg_user['id'])
    username = tg_user.get('username') or ''
    first_name = tg_user.get('first_name') or ''
    session_token = database.create_miniapp_session(telegram_id, username=username or None, first_name=first_name or None, photo_url=tg_user.get('photo_url'))
    if not session_token:
        return (jsonify({'error': 'Не удалось создать сессию'}), 500)
    return jsonify({'success': True, 'session_token': session_token, 'telegram_id': telegram_id, 'username': username, 'first_name': first_name, 'photo_url': tg_user.get('photo_url')})

@app.route('/api/auth/me', methods=['GET'])

def miniapp_auth_me():
    tg_user = get_telegram_user_from_request()
    if not tg_user:
        return (jsonify({'error': 'Unauthorized'}), 401)
    telegram_id = int(tg_user['id'])
    user = database.get_user_by_telegram_id(telegram_id)
    return jsonify({'telegram_id': telegram_id, 'username': tg_user.get('username') or (user or {}).get('username'), 'first_name': tg_user.get('first_name') or (user or {}).get('full_name'), 'photo_url': tg_user.get('photo_url'), 'user_id': user['id'] if user else None})

@app.route('/api/auth/logout', methods=['POST'])

def miniapp_logout():
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:].strip()
        if token:
            database.delete_miniapp_session(token)
    return jsonify({'success': True})

@app.route('/api/user/info', methods=['GET'])

def get_user_info():
    telegram_id = request.args.get('telegram_id', type=int)
    username = request.args.get('username', '')
    first_name = request.args.get('first_name', '')
    ref = request.args.get('ref', type=int)
    if not telegram_id:
        return (jsonify({'error': 'telegram_id required'}), 400)
    if ref == telegram_id:
        ref = None
    user = database.get_user_by_telegram_id(telegram_id)
    is_new_user = False
    if not user:
        is_new_user = True
        referred_by = None
        referrer = None
        if ref:
            referrer = database.get_user_by_telegram_id(ref)
            if referrer:
                if database.check_referral_rate_limit(ref, limit=25, window_seconds=60):
                    referred_by = referrer['id']
                    logger.info(f'Referral accepted: user {telegram_id} referred by {ref}')
                else:
                    logger.warning(f'Referral rate limit exceeded for referrer {ref}')
        user_id = database.create_user(telegram_id, username or f'user_{telegram_id}', full_name=first_name or None, referred_by=referred_by)
        user = database.get_user_by_id(user_id)
        if not user:
            return (jsonify({'error': 'Failed to create user'}), 500)
        if referred_by and referrer:
            try:
                new_user_name = first_name or username or f'user_{telegram_id}'
                msg = f'🎉 <b>Новый реферал!</b>\n\nПользователь <b>{new_user_name}</b> присоединился по вашей ссылке.\nВы получите 50₽ за его первую покупку!'
                core.send_notification_to_user(referrer['telegram_id'], msg)
                logger.info(f'Notified referrer {ref} about new referral {telegram_id}')
            except Exception as e:
                logger.error(f'Failed to notify referrer about new referral: {e}')
    else:
        if ref and user.get('referred_by') is None:
            referrer = database.get_user_by_telegram_id(ref)
            if referrer:
                if database.check_referral_rate_limit(ref, limit=25, window_seconds=60):
                    if database.set_referrer_for_user(user['id'], referrer['id']):
                        logger.info(f'Referral set for existing user {telegram_id} -> {ref}')
                        user = database.get_user_by_telegram_id(telegram_id)
                else:
                    logger.warning(f'Referral rate limit exceeded for referrer {ref}')
        if first_name and first_name != user.get('full_name'):
            database.update_user_full_name(telegram_id, first_name)
            user = database.get_user_by_telegram_id(telegram_id)
    ban_status = abuse_detected.check_user_ban_status(user['id'], telegram_id)
    if ban_status.get('banned'):
        return (jsonify({'banned': True, 'reason': ban_status.get('reason', 'Аккаунт заблокирован'), 'blacklisted': ban_status.get('blacklisted', False)}), 403)
    stats = core.get_referral_stats(user['id'])
    return jsonify({'id': user['id'], 'telegram_id': user['telegram_id'], 'username': user.get('username'), 'full_name': user.get('full_name'), 'balance': user.get('balance', 0), 'status': user.get('status', 'Trial'), 'referral_code': user.get('referral_code'), 'partner_balance': stats.get('partner_balance', 0), 'referral_balance': stats.get('partner_balance', 0), 'referrals_count': stats.get('referrals_count', 0), 'referral_earned': stats.get('partner_balance', 0), 'referral_rate': stats.get('rate', 20), 'is_new_user': is_new_user, 'trial_used': user.get('trial_used', 0), 'promo_discount_percent': user.get('promo_discount_percent'), 'pending_promo_days': user.get('pending_promo_days')})

@app.route('/api/payment/create', methods=['POST'])

def create_payment():
    data = request.json
    user_id = data.get('user_id')
    amount = data.get('amount')
    method = data.get('method')
    if not user_id or not amount or (not method):
        return (jsonify({'error': 'Missing required fields'}), 400)
    user = database.get_user_by_id(user_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    miniapp_url = os.getenv('MINIAPP_URL', '')
    return_url = f'{miniapp_url}/success' if miniapp_url else None
    failed_url = f'{miniapp_url}/failed' if miniapp_url else None
    try:
        if method == 'platega_card':
            payment = platega.platega_api.create_card_payment(amount, user_id, return_url=return_url, failed_url=failed_url)
            if isinstance(payment, dict) and payment.get('ok') is False:
                details = payment.get('details') or payment
                provider_resp = details.get('response') if isinstance(details, dict) else None
                msg = None
                if isinstance(provider_resp, dict):
                    msg = provider_resp.get('message') or provider_resp.get('error')
                return (jsonify({'error': msg or 'Platega error', 'provider': 'platega', 'details': provider_resp or details}), 400)
            if payment and payment.get('ok') is True:
                return jsonify({'payment_id': payment.get('id'), 'payment_url': payment.get('redirect_url'), 'status': payment.get('status', 'pending')})
        elif method == 'platega_sbp':
            payment = platega.platega_api.create_sbp_payment(amount, user_id, return_url=return_url, failed_url=failed_url)
            if isinstance(payment, dict) and payment.get('ok') is False:
                details = payment.get('details') or payment
                provider_resp = details.get('response') if isinstance(details, dict) else None
                msg = None
                if isinstance(provider_resp, dict):
                    msg = provider_resp.get('message') or provider_resp.get('error')
                return (jsonify({'error': msg or 'Platega error', 'provider': 'platega', 'details': provider_resp or details}), 400)
            if payment and payment.get('ok') is True:
                return jsonify({'payment_id': payment.get('id'), 'payment_url': payment.get('redirect_url'), 'status': payment.get('status', 'pending')})
        else:
            return (jsonify({'error': f'Unknown payment method: {method}'}), 400)
    except Exception as e:
        logger.error(f'Payment creation error for method {method}: {e}')
    return (jsonify({'error': 'Payment creation failed'}), 400)

@app.route('/api/promocode/apply', methods=['POST'])

def apply_promocode():
    data = request.json
    user_id = data.get('user_id')
    code = data.get('code')
    if not user_id or not code:
        return (jsonify({'error': 'Missing required fields'}), 400)
    result = core.apply_promocode(user_id, code)
    return jsonify(result)

@app.route('/api/user/devices', methods=['GET'])

def get_user_devices():
    telegram_id = request.args.get('telegram_id', type=int)
    if not telegram_id:
        return (jsonify({'error': 'telegram_id required'}), 400)
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    try:
        rw_users = remnawave.remnawave_api.get_user_by_telegram_id(telegram_id)
        if rw_users:
            conn_sync = database.get_db_connection()
            cursor_sync = conn_sync.cursor()
            for rw_user in rw_users:
                rw_uuid = rw_user.uuid if hasattr(rw_user, 'uuid') else rw_user.get('uuid')
                traffic_used = 0
                if hasattr(rw_user, 'user_traffic') and rw_user.user_traffic:
                    traffic_used = rw_user.user_traffic.used_traffic_bytes
                elif hasattr(rw_user, 'used_traffic_bytes'):
                    traffic_used = rw_user.used_traffic_bytes
                if rw_uuid and traffic_used > 0:
                    cursor_sync.execute('\n                        UPDATE vpn_keys SET traffic_used = ? WHERE key_uuid = ?\n                    ', (traffic_used, rw_uuid))
            conn_sync.commit()
            conn_sync.close()
    except Exception as e:
        logger.warning(f'Failed to sync traffic from Remnawave: {e}')
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("\n            SELECT id, key_config, key_uuid, status as key_status, expiry_date,\n                   traffic_used, traffic_limit, plan_type, created_at\n            FROM vpn_keys\n            WHERE user_id = ? AND key_uuid IS NOT NULL AND status != 'Deleted'\n            ORDER BY created_at DESC\n        ", (user['id'],))
        rows = cursor.fetchall()
        devices = []
        for row in rows:
            from datetime import datetime
            created_at = row['created_at']
            if created_at:
                try:
                    if isinstance(created_at, str):
                        dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                    else:
                        dt = created_at
                    added_formatted = dt.strftime('%d.%m.%Y')
                except:
                    added_formatted = str(created_at)[:10]
            else:
                added_formatted = datetime.now().strftime('%d.%m.%Y')
            days_left = None
            hours_left = None
            is_expired = False
            expiry_date_str = None
            if row['expiry_date']:
                try:
                    if isinstance(row['expiry_date'], str):
                        expiry_dt = datetime.fromisoformat(row['expiry_date'].replace('Z', '+00:00'))
                    else:
                        expiry_dt = row['expiry_date']
                    if expiry_dt.tzinfo:
                        expiry_dt = expiry_dt.replace(tzinfo=None)
                    now = datetime.now()
                    diff = expiry_dt - now
                    total_seconds = diff.total_seconds()
                    if total_seconds <= 0:
                        is_expired = True
                        days_left = 0
                        hours_left = 0
                    else:
                        import math
                        total_hours = total_seconds / 3600
                        days_left = int(total_hours / 24)
                        hours_left = int(math.ceil(total_hours % 24))
                        if days_left == 0 and hours_left > 0:
                            days_left = 0
                    expiry_date_str = format_datetime_msk(expiry_dt)
                except Exception as e:
                    logger.error(f'Error parsing expiry_date: {e}')
            short_uuid = row['key_uuid'][:8] if row['key_uuid'] else None
            device_name = 'VPN подписка'
            plan_type = 'vpn'
            try:
                if 'plan_type' in row.keys():
                    plan_type = row['plan_type'] or 'vpn'
            except:
                plan_type = 'vpn'
            devices.append({'id': row['id'], 'name': device_name, 'type': 'universal', 'added': added_formatted, 'key_config': row['key_config'], 'key_uuid': row['key_uuid'], 'short_uuid': short_uuid, 'key_status': row['key_status'], 'days_left': days_left, 'hours_left': hours_left, 'is_expired': is_expired, 'expiry_date': expiry_date_str, 'traffic_used': row['traffic_used'], 'traffic_limit': row['traffic_limit'], 'plan_type': plan_type})
        return jsonify(devices)
    finally:
        conn.close()

@app.route('/api/user/history', methods=['GET'])

def get_user_history():
    telegram_id = request.args.get('telegram_id', type=int)
    if not telegram_id:
        return (jsonify({'error': 'telegram_id required'}), 400)
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT id, type, amount, description, created_at, status, payment_method\n            FROM transactions\n            WHERE user_id = ?\n            ORDER BY created_at DESC\n            LIMIT 100\n        ', (user['id'],))
        rows = cursor.fetchall()
        history = []
        for row in rows:
            type_map = {'deposit': 'deposit', 'withdrawal': 'withdrawal', 'subscription': 'sub_off', 'device_purchase': 'buy_dev', 'trial': 'trial'}
            title_map = {'deposit': f"Пополнение баланса ({row['payment_method'] or ''})", 'withdrawal': 'Вывод средств', 'subscription': 'Списание за подписку', 'device_purchase': 'Покупка устройства', 'trial': 'Активация пробного периода'}
            trans_type = type_map.get(row['type'], row['type'])
            title = row['description'] or title_map.get(row['type'], row['type'])
            from datetime import datetime
            date_str = row['created_at']
            if date_str:
                try:
                    if isinstance(date_str, str):
                        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    else:
                        dt = date_str
                    months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
                    month_idx = dt.month - 1
                    date_formatted = f'{dt.day} {months[month_idx]} {dt.year}'
                except:
                    date_formatted = str(date_str)[:10]
            else:
                date_formatted = datetime.now().strftime('%d %b %Y')
            history.append({'id': row['id'], 'type': trans_type, 'title': title, 'amount': float(row['amount']), 'date': date_formatted})
        return jsonify(history)
    finally:
        conn.close()

@app.route('/api/user/payment-methods', methods=['GET'])

def get_user_payment_methods():
    telegram_id = request.args.get('telegram_id', type=int)
    if not telegram_id:
        return (jsonify({'error': 'telegram_id required'}), 400)
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT id, payment_provider, payment_method_id, payment_method_type, \n                   card_last4, card_brand, created_at\n            FROM saved_payment_methods\n            WHERE user_id = ? AND is_active = 1\n            ORDER BY created_at DESC\n        ', (user['id'],))
        rows = cursor.fetchall()
        methods = []
        for row in rows:
            methods.append({'id': row['id'], 'provider': row['payment_provider'], 'payment_method_id': row['payment_method_id'], 'type': row['payment_method_type'], 'card_last4': row['card_last4'], 'card_brand': row['card_brand'], 'created_at': row['created_at']})
        return jsonify(methods)
    finally:
        conn.close()

@app.route('/api/user/payment-methods/<int:method_id>', methods=['DELETE'])

def delete_payment_method(method_id: int):
    telegram_id = request.args.get('telegram_id', type=int)
    if not telegram_id:
        return (jsonify({'error': 'telegram_id required'}), 400)
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            UPDATE saved_payment_methods\n            SET is_active = 0\n            WHERE id = ? AND user_id = ?\n        ', (method_id, user['id']))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/user/devices/<int:device_id>', methods=['DELETE'])

def delete_user_device(device_id: int):
    telegram_id = request.args.get('telegram_id', type=int)
    if not telegram_id:
        return (jsonify({'error': 'telegram_id required'}), 400)
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT id, key_uuid FROM vpn_keys\n            WHERE id = ? AND user_id = ?\n        ', (device_id, user['id']))
        device = cursor.fetchone()
        if not device:
            return (jsonify({'error': 'Device not found'}), 404)
        key_uuid = device['key_uuid']
        if key_uuid:
            try:
                remnawave.remnawave_api.delete_user_sync(key_uuid)
                logger.info(f'Deleted key {key_uuid} from Remnawave')
            except Exception as e:
                logger.error(f'Failed to delete key {key_uuid} from Remnawave: {e}')
        cursor.execute('DELETE FROM vpn_keys WHERE id = ?', (device_id,))
        conn.commit()
        logger.info(f'Device {device_id} deleted for user {telegram_id}')
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        logger.error(f'Error deleting device {device_id}: {e}')
        return (jsonify({'error': str(e)}), 500)
    finally:
        conn.close()

@app.route('/api/subscription/extend', methods=['POST'])

def extend_subscription():
    data = request.json
    user_id = data.get('user_id')
    key_id = data.get('key_id')
    days = data.get('days')
    price = data.get('price', 0)
    if not user_id or not key_id or (not days):
        return (jsonify({'error': 'Missing required fields'}), 400)
    user = database.get_user_by_id(user_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    base_price = float(price or 0)
    disc_pct = float(user.get('promo_discount_percent') or 0)
    price = base_price
    applied_promo_discount = False
    if disc_pct > 0 and base_price > 0:
        price = round(base_price * (1 - min(disc_pct, 100) / 100), 2)
        applied_promo_discount = True
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT id, key_uuid, expiry_date, plan_type, traffic_limit, status\n            FROM vpn_keys WHERE id = ? AND user_id = ?\n        ', (key_id, user_id))
        key_row = cursor.fetchone()
        if not key_row:
            return (jsonify({'error': 'Key not found'}), 404)
        key_uuid = key_row['key_uuid']
        current_expiry = key_row['expiry_date']
        plan_type = key_row['plan_type'] or 'vpn'
        if price > 0:
            deducted = database.update_user_balance(user_id, -price, ensure_non_negative=True)
            if not deducted:
                return (jsonify({'error': 'Insufficient balance'}), 400)
        from datetime import datetime, timedelta
        if current_expiry:
            try:
                expiry_dt = datetime.fromisoformat(current_expiry.replace('Z', '+00:00').replace('+00:00', ''))
            except:
                expiry_dt = datetime.now()
            if expiry_dt < datetime.now():
                new_expiry = datetime.now() + timedelta(days=days)
            else:
                new_expiry = expiry_dt + timedelta(days=days)
        else:
            new_expiry = datetime.now() + timedelta(days=days)
        new_expiry_str = new_expiry.isoformat()
        if key_uuid:
            try:
                remnawave.remnawave_api.update_user_sync(uuid=key_uuid, expire_at=new_expiry, status=remnawave.UserStatus.ACTIVE)
            except Exception as e:
                logger.error(f'Failed to update key in Remnawave: {e}')
                if price > 0:
                    database.update_user_balance(user_id, price)
                return (jsonify({'error': 'Failed to extend subscription in VPN system'}), 500)
        cursor.execute("\n            UPDATE vpn_keys SET \n                status = 'Active',\n                expiry_date = ?\n            WHERE id = ?\n        ", (new_expiry_str, key_id))
        conn.commit()
        description = f'Продление подписки ({days} дней)'
        cursor.execute("\n            INSERT INTO transactions (user_id, type, amount, status, description, payment_method, duration_days)\n            VALUES (?, 'subscription_extend', ?, 'Success', ?, 'Balance', ?)\n        ", (user_id, -price, description, int(days)))
        conn.commit()
        if price > 0:
            referral_result = database.credit_referral_income(user_id, price, f'Доход от продления подписки ({description})')
            if referral_result:
                logger.info(f"Credited {referral_result['income']}₽ to referrer for extension")
                try:
                    referrer_telegram_id = referral_result['referrer_telegram_id']
                    income = referral_result['income']
                    msg = f'💰 <b>Реферальный доход!</b>\n\nВаш реферал совершил первую покупку.\nВаше вознаграждение: <b>{income:.0f}₽</b>\n\nСредства зачислены на ваш основной баланс.'
                    core.send_notification_to_user(referrer_telegram_id, msg)
                except Exception as e:
                    logger.error(f'Failed to notify referrer: {e}')
        if applied_promo_discount:
            database.clear_user_promo_discount(user_id)
        return jsonify({'success': True, 'key_id': key_id, 'new_expiry': new_expiry_str})
    except Exception as e:
        logger.error(f'Error extending subscription: {e}')
        import traceback
        traceback.print_exc()
        return (jsonify({'error': str(e)}), 500)
    finally:
        conn.close()

@app.route('/api/subscription/create', methods=['POST'])

def create_subscription():
    data = request.json
    user_id = data.get('user_id')
    days = data.get('days')
    plan_type = data.get('type', 'vpn_regular')
    tariff_category = data.get('tariff_category', 'family' if plan_type == 'vpn_family' else 'regular')
    devices_limit = int(data.get('devices_limit') or (5 if tariff_category == 'family' else 2))
    use_auto_pay = data.get('use_auto_pay', False)
    payment_method_id = data.get('payment_method_id')
    is_trial = data.get('is_trial', False)
    from_pending_promo = bool(data.get('from_pending_promo'))
    if not user_id or not days:
        return (jsonify({'error': 'Missing required fields'}), 400)
    user = database.get_user_by_id(user_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    user_keys = database.get_user_vpn_keys(user_id)
    now = datetime.now()
    for k in user_keys:
        if k.get('status') == 'Deleted':
            continue
        exp = k.get('expiry_date')
        is_live = False
        if exp:
            try:
                expiry_dt = datetime.fromisoformat(str(exp).replace('Z', '+00:00'))
                if expiry_dt.tzinfo:
                    expiry_dt = expiry_dt.replace(tzinfo=None)
                is_live = expiry_dt > now
            except Exception:
                is_live = k.get('status') == 'Active'
        elif k.get('status') == 'Active':
            is_live = True
        if is_live:
            return (jsonify({'error': 'У вас уже есть активная подписка. Продлите её в разделе «Подписка».'}), 409)
    finalize_promo_id = None
    if from_pending_promo:
        if is_trial:
            return (jsonify({'error': 'Invalid request'}), 400)
        pending_pid = user.get('pending_promo_id')
        pending_days = user.get('pending_promo_days')
        if not pending_pid or not pending_days:
            return (jsonify({'error': 'Сначала активируйте промокод на подписку'}), 400)
        ok_pending, err_pending = database.check_promo_available_for_user(int(pending_pid), user_id)
        if not ok_pending:
            database.clear_pending_promo_subscription(user_id)
            return (jsonify({'error': err_pending}), 400)
        days = int(pending_days)
        price = 0.0
        had_promo_discount = False
        finalize_promo_id = int(pending_pid)
    else:
        disc_pct = float(user.get('promo_discount_percent') or 0)
        had_promo_discount = False
        if is_trial:
            if user.get('trial_used', 0) == 1:
                return (jsonify({'error': 'Пробный период уже использован'}), 400)
            days = int(data.get('days', 7) or 7)
            price = float(data.get('price', 1) or 1)
            devices_limit = int(data.get('devices_limit', 2) or 2)
            plan_type = 'vpn_regular'
            tariff_category = 'regular'
        else:
            base_price = float(data.get('price', days * 5) or 0)
            price = base_price
            if disc_pct > 0 and base_price > 0:
                price = round(base_price * (1 - min(disc_pct, 100) / 100), 2)
                had_promo_discount = True
    if price > 0:
        deducted = database.update_user_balance(user_id, -price, ensure_non_negative=True)
        if not deducted:
            return (jsonify({'error': 'Insufficient balance'}), 400)
    logger.info(f"Creating subscription for user_id={user_id}, telegram_id={user['telegram_id']}, days={days}, is_trial={is_trial}")
    if is_trial:
        traffic_limit_bytes = int(10 * 1024 ** 3)
        result = core.create_user_and_subscription(user['telegram_id'], user.get('username', ''), days, traffic_limit=traffic_limit_bytes, plan_type=plan_type, devices_limit=devices_limit, force_new=False)
    else:
        result = core.create_user_and_subscription(user['telegram_id'], user.get('username', ''), days, traffic_limit=0, plan_type=plan_type, devices_limit=devices_limit, force_new=False)
    logger.info(f'Subscription creation result: {result is not None}, result={result}')
    if result:
        conn = database.get_db_connection()
        cursor = conn.cursor()
        if is_trial:
            cursor.execute('UPDATE users SET trial_used = 1 WHERE id = ?', (user_id,))
            description = f'Пробная подписка ({days} дней)'
            trans_type = 'trial'
        else:
            if finalize_promo_id:
                description = f'Подписка по промокоду ({days} дней)'
            else:
                tariff_label = 'Семейный' if tariff_category == 'family' else 'Обычный'
                description = f'{tariff_label} тариф ({days} дней)'
            trans_type = 'subscription'
        cursor.execute("\n            INSERT INTO transactions (user_id, type, amount, status, description, payment_method, duration_days)\n            VALUES (?, ?, ?, 'Success', ?, 'Balance', ?)\n        ", (user_id, trans_type, -price, description, int(days)))
        conn.commit()
        conn.close()
        if not is_trial and had_promo_discount:
            database.clear_user_promo_discount(user_id)
        if finalize_promo_id:
            if not database.finalize_promo_subscription_use(user_id, finalize_promo_id):
                logger.error('finalize_promo_subscription_use failed user_id=%s promo_id=%s', user_id, finalize_promo_id)
        if not is_trial and price > 0:
            referral_result = database.credit_referral_income(user_id, price, f'Доход от покупки подписки ({description})')
            if referral_result:
                logger.info(f"Credited {referral_result['income']}₽ to referrer {referral_result['referrer_telegram_id']}")
                try:
                    referrer_telegram_id = referral_result['referrer_telegram_id']
                    income = referral_result['income']
                    msg = f'💰 <b>Реферальный доход!</b>\n\nВаш реферал совершил первую покупку.\nВаше вознаграждение: <b>{income:.0f}₽</b>\n\nСредства зачислены на ваш основной баланс.'
                    core.send_notification_to_user(referrer_telegram_id, msg)
                except Exception as e:
                    logger.error(f'Failed to notify referrer: {e}')
        return jsonify({'success': True, 'subscription': result})
    if price > 0:
        database.update_user_balance(user_id, price)
    return (jsonify({'error': 'Failed to create subscription'}), 500)

@app.route('/api/panel/users', methods=['GET'])

@require_auth

def get_users():
    limit = min(request.args.get('limit', 50, type=int), 200)
    offset = request.args.get('offset', 0, type=int)
    search = (request.args.get('search') or '').strip() or None
    raw_users, total = database.search_panel_users(search=search, limit=limit, offset=offset)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT telegram_id FROM blacklist')
    blacklisted_ids = set((row['telegram_id'] for row in cursor.fetchall()))
    conn.close()
    for user in raw_users:
        user['in_blacklist'] = user.get('telegram_id') in blacklisted_ids
    return jsonify({'users': raw_users, 'total': total, 'limit': limit, 'offset': offset})

@app.route('/api/panel/promocodes', methods=['GET'])

@require_auth

def get_promocodes():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM promocodes ORDER BY id DESC')
    promos = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(promos)

@app.route('/api/panel/promocodes', methods=['POST'])

@require_auth

def create_promocode():
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute('\n        INSERT INTO promocodes (code, type, value, uses_limit, expires_at, is_active, target_type)\n        VALUES (?, ?, ?, ?, ?, ?, ?)\n        ', (data.get('code', '').upper(), data.get('type'), str(data.get('value')), data.get('uses_limit'), data.get('expires_at'), 1 if data.get('is_active', 1) else 0, data.get('target_type', 'all')))
    conn.commit()
    promo_id = cursor.lastrowid
    cursor.execute('SELECT * FROM promocodes WHERE id = ?', (promo_id,))
    promo = dict(cursor.fetchone())
    conn.close()
    return jsonify({'id': promo_id, 'success': True, 'promocode': promo})

@app.route('/api/panel/promocodes/<int:promo_id>', methods=['PUT'])

@require_auth

def update_promocode(promo_id: int):
    data = request.json or {}
    conn = database.get_db_connection()
    cursor = conn.cursor()
    fields = []
    values = []
    mapping = {'code': 'code', 'type': 'type', 'value': 'value', 'uses_limit': 'uses_limit', 'expires_at': 'expires_at', 'is_active': 'is_active', 'target_type': 'target_type'}
    for key, column in mapping.items():
        if key in data:
            val = data[key]
            if key == 'code' and isinstance(val, str):
                val = val.upper()
            if key == 'is_active':
                val = 1 if val else 0
            fields.append(f'{column} = ?')
            values.append(val)
    if not fields:
        conn.close()
        return (jsonify({'success': False, 'error': 'Nothing to update'}), 400)
    values.append(promo_id)
    cursor.execute(f"UPDATE promocodes SET {', '.join(fields)} WHERE id = ?", tuple(values))
    conn.commit()
    cursor.execute('SELECT * FROM promocodes WHERE id = ?', (promo_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return (jsonify({'success': False, 'error': 'Promocode not found'}), 404)
    return jsonify({'success': True, 'promocode': dict(row)})

@app.route('/api/panel/promocodes/<int:promo_id>', methods=['DELETE'])

@require_auth

def delete_promocode(promo_id: int):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT id FROM promocodes WHERE id = ?', (promo_id,))
        if not cursor.fetchone():
            return (jsonify({'success': False, 'error': 'Promocode not found'}), 404)
        cursor.execute('UPDATE users SET pending_promo_id = NULL, pending_promo_days = NULL WHERE pending_promo_id = ?', (promo_id,))
        cursor.execute('DELETE FROM promocode_uses WHERE promocode_id = ?', (promo_id,))
        cursor.execute('DELETE FROM promocodes WHERE id = ?', (promo_id,))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/panel/mailing', methods=['POST'])

@require_auth

def send_mailing():
    data = request.json
    message = data.get('message')
    target_users = data.get('target_users', 'all')
    if isinstance(target_users, str):
        target_users = target_users.strip().lower()
    button_type = data.get('button_type')
    button_value = data.get('button_value')
    image_url = data.get('image_url')
    parse_mode = data.get('parse_mode', 'HTML')
    if not message:
        return (jsonify({'success': False, 'error': 'Message is required'}), 400)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        user_rows = []
        if target_users == 'all':
            cursor.execute('SELECT id, telegram_id FROM users WHERE is_banned = 0 OR is_banned IS NULL')
            user_rows = cursor.fetchall()
        elif target_users == 'active':
            cursor.execute("\n                SELECT DISTINCT u.id, u.telegram_id\n                FROM users u\n                WHERE (u.is_banned = 0 OR u.is_banned IS NULL)\n                  AND EXISTS (\n                      SELECT 1\n                      FROM vpn_keys vk\n                      WHERE vk.user_id = u.id\n                        AND vk.status = 'Active'\n                        AND vk.expiry_date > datetime('now')\n                  )\n            ")
            user_rows = cursor.fetchall()
        elif target_users == 'expired':
            cursor.execute("\n                SELECT DISTINCT u.id, u.telegram_id\n                FROM users u\n                WHERE (u.is_banned = 0 OR u.is_banned IS NULL)\n                  AND EXISTS (\n                      SELECT 1\n                      FROM vpn_keys vk_any\n                      WHERE vk_any.user_id = u.id\n                  )\n                  AND NOT EXISTS (\n                      SELECT 1\n                      FROM vpn_keys vk_active\n                      WHERE vk_active.user_id = u.id\n                        AND vk_active.status = 'Active'\n                        AND vk_active.expiry_date > datetime('now')\n                  )\n            ")
            user_rows = cursor.fetchall()
        elif target_users == 'no_subscription':
            cursor.execute('\n                SELECT DISTINCT u.id, u.telegram_id\n                FROM users u\n                WHERE (u.is_banned = 0 OR u.is_banned IS NULL)\n                  AND NOT EXISTS (\n                      SELECT 1\n                      FROM vpn_keys vk\n                      WHERE vk.user_id = u.id\n                  )\n            ')
            user_rows = cursor.fetchall()
        elif isinstance(target_users, list):
            placeholders = ','.join(('?' for _ in target_users))
            cursor.execute(f'SELECT id, telegram_id FROM users WHERE id IN ({placeholders}) AND (is_banned = 0 OR is_banned IS NULL)', tuple(target_users))
            user_rows = cursor.fetchall()
        reply_markup = None
        miniapp_url = os.getenv('MINIAPP_URL', '')
        if button_type and button_value:
            if button_type == 'external_link' or button_type == 'url':
                if '|' in button_value:
                    btn_text, btn_url = button_value.split('|', 1)
                else:
                    btn_text = 'Перейти'
                    btn_url = button_value
                reply_markup = {'inline_keyboard': [[{'text': btn_text, 'url': btn_url}]]}
            elif button_type == 'open_miniapp' or button_type == 'webapp':
                btn_text = button_value if button_value else 'Открыть приложение'
                reply_markup = {'inline_keyboard': [[{'text': btn_text, 'web_app': {'url': miniapp_url}}]]}
            elif button_type == 'activate_promo':
                promo_url = f"https://t.me/{os.getenv('BOT_USERNAME', 'onefederalbot')}?start=promo_{button_value}"
                reply_markup = {'inline_keyboard': [[{'text': f'🎁 Активировать промокод {button_value}', 'url': promo_url}]]}
            elif button_type == 'add_balance':
                balance_url = f'{miniapp_url}?view=topup&amount={button_value}'
                reply_markup = {'inline_keyboard': [[{'text': f'💰 Пополнить на {button_value}₽', 'web_app': {'url': balance_url}}]]}
        cursor.execute("\n            INSERT INTO mailings (title, message_text, target_users, sent_count, status, sent_at, button_type, button_value, image_url)\n            VALUES (?, ?, ?, 0, 'InProgress', NULL, ?, ?, ?)\n            ", (data.get('title', ''), message, str(target_users), button_type, button_value, image_url))
        mailing_id = cursor.lastrowid
        conn.commit()
        bot_token = os.getenv('TELEGRAM_BOT_TOKEN', '')
        sent = 0
        errors = 0
        for row in user_rows:
            telegram_id = row['telegram_id']
            user_id = row['id']
            try:
                tg_result = None
                if bot_token:
                    if image_url:
                        payload = {'chat_id': telegram_id, 'photo': image_url, 'caption': message, 'parse_mode': parse_mode}
                        if reply_markup:
                            payload['reply_markup'] = json.dumps(reply_markup, ensure_ascii=False)
                        tg_result = _telegram_api(bot_token, 'sendPhoto', payload)
                    else:
                        payload = {'chat_id': telegram_id, 'text': message, 'parse_mode': parse_mode}
                        if reply_markup:
                            payload['reply_markup'] = reply_markup
                        tg_result = _telegram_api(bot_token, 'sendMessage', payload)
                if tg_result and tg_result.get('message_id'):
                    sent += 1
                    cursor.execute('\n                        INSERT INTO mailing_deliveries (mailing_id, user_id, telegram_id, chat_id, message_id)\n                        VALUES (?, ?, ?, ?, ?)\n                        ', (mailing_id, user_id, telegram_id, telegram_id, int(tg_result['message_id'])))
                else:
                    errors += 1
            except Exception as e:
                logger.error(f'Error sending mailing to {telegram_id}: {e}')
                errors += 1
        cursor.execute("\n            UPDATE mailings\n            SET sent_count = ?, status = 'Completed', sent_at = CURRENT_TIMESTAMP\n            WHERE id = ?\n            ", (len(user_rows), mailing_id))
        conn.commit()
    finally:
        conn.close()
    return jsonify({'success': True, 'sent': sent, 'total': len(user_rows), 'errors': errors})

@app.route('/api/panel/mailing/stats', methods=['GET'])

@require_auth

def get_mailing_stats():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) AS total FROM mailings WHERE status = 'Completed'")
        total_sent = cursor.fetchone()['total'] or 0
        return jsonify({'totalSent': total_sent})
    finally:
        conn.close()

@app.route('/api/panel/mailing/history', methods=['GET'])

@require_auth

def get_mailing_history():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT id, title, message_text, sent_count, status, sent_at, created_at\n            FROM mailings\n            ORDER BY created_at DESC\n            LIMIT 50\n        ')
        rows = cursor.fetchall()
        history = []
        for row in rows:
            from datetime import datetime
            date_str = row['sent_at'] or row['created_at']
            if date_str:
                try:
                    if isinstance(date_str, str):
                        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    else:
                        dt = date_str
                    date_formatted = dt.strftime('%d.%m.%y')
                except:
                    date_formatted = str(date_str)[:10]
            else:
                date_formatted = ''
            history.append({'id': row['id'], 'title': row['title'] or row['message_text'][:50] if row['message_text'] else 'Без названия', 'message_text': row['message_text'] or '', 'sent_count': row['sent_count'] or 0, 'status': row['status'], 'date': date_formatted})
        return jsonify(history)
    finally:
        conn.close()

@app.route('/api/panel/mailing/<int:mailing_id>/recall', methods=['POST'])

@require_auth

def recall_mailing(mailing_id: int):
    bot_token = os.getenv('TELEGRAM_BOT_TOKEN', '')
    if not bot_token:
        return (jsonify({'error': 'TELEGRAM_BOT_TOKEN is not configured'}), 400)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT id FROM mailings WHERE id = ?', (mailing_id,))
        row = cursor.fetchone()
        if not row:
            return (jsonify({'error': 'Mailing not found'}), 404)
        cursor.execute('\n            SELECT id, chat_id, message_id\n            FROM mailing_deliveries\n            WHERE mailing_id = ? AND deleted_at IS NULL\n        ', (mailing_id,))
        deliveries = cursor.fetchall()
        deleted = 0
        failed = 0
        for delivery in deliveries:
            result = _telegram_api(bot_token, 'deleteMessage', {'chat_id': int(delivery['chat_id']), 'message_id': int(delivery['message_id'])})
            if result is True:
                deleted += 1
                cursor.execute('UPDATE mailing_deliveries SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', (delivery['id'],))
            else:
                failed += 1
        cursor.execute('DELETE FROM mailings WHERE id = ?', (mailing_id,))
        conn.commit()
        return jsonify({'success': True, 'deleted': deleted, 'failed': failed})
    finally:
        conn.close()

@app.route('/api/panel/transactions', methods=['GET'])

@require_auth

def get_transactions():
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("\n            SELECT \n                t.id,\n                t.user_id,\n                u.username,\n                t.type,\n                t.amount,\n                t.status,\n                t.payment_method,\n                t.payment_provider,\n                t.payment_id,\n                t.hash,\n                t.created_at\n            FROM transactions t\n            LEFT JOIN users u ON t.user_id = u.id\n            WHERE t.type IN ('deposit', 'withdrawal_request')\n              AND t.status = 'Success'\n              AND t.payment_method != 'Admin'\n            ORDER BY t.created_at DESC\n            LIMIT ? OFFSET ?\n        ", (limit, offset))
        rows = cursor.fetchall()
        transactions = []
        for row in rows:
            username = row['username'] or f"user_{row['user_id']}"
            transactions.append({'id': row['id'], 'user_id': row['user_id'], 'user': f'@{username}' if username and (not username.startswith('@')) else username, 'amount': float(row['amount']), 'type': row['type'], 'status': row['status'] or 'Pending', 'payment_method': row['payment_method'] or 'Unknown', 'payment_provider': row['payment_provider'] or '', 'payment_id': row['payment_id'] or '', 'hash': row['hash'] or row['payment_id'] or '', 'created_at': row['created_at']})
        return jsonify(transactions)
    finally:
        conn.close()

@app.route('/api/panel/transactions/<int:transaction_id>/refund', methods=['POST'])

@require_auth

def refund_transaction(transaction_id: int):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT t.*, u.telegram_id, u.username\n            FROM transactions t\n            LEFT JOIN users u ON t.user_id = u.id\n            WHERE t.id = ?\n        ', (transaction_id,))
        transaction = cursor.fetchone()
        if not transaction:
            return (jsonify({'success': False, 'error': 'Транзакция не найдена'}), 404)
        if transaction['type'] != 'deposit':
            return (jsonify({'success': False, 'error': 'Возврат возможен только для пополнений'}), 400)
        if transaction['status'] == 'Refunded':
            return (jsonify({'success': False, 'error': 'Транзакция уже была возвращена'}), 400)
        amount = float(transaction['amount'])
        user_id = transaction['user_id']
        payment_id = transaction['payment_id']
        payment_provider = transaction['payment_provider']
        refund_result = None
        user = database.get_user_by_id(user_id)
        if user:
            current_balance = user.get('balance', 0)
            new_balance = max(0, current_balance - amount)
            cursor.execute('\n                UPDATE users SET balance = ? WHERE id = ?\n            ', (new_balance, user_id))
        cursor.execute("\n            UPDATE transactions \n            SET status = 'Refunded', refunded_at = CURRENT_TIMESTAMP\n            WHERE id = ?\n        ", (transaction_id,))
        cursor.execute("\n            INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, description)\n            VALUES (?, 'refund', ?, 'Success', ?, ?, ?)\n        ", (user_id, -amount, transaction['payment_method'], payment_provider, f'Возврат по транзакции #{transaction_id}'))
        conn.commit()
        if transaction['telegram_id']:
            core.send_notification_to_user(transaction['telegram_id'], f'💸 Возврат средств: {amount}₽ по транзакции #{transaction_id}')
        logger.info(f'Возврат по транзакции #{transaction_id}: {amount}₽ для user {user_id}')
        return jsonify({'success': True, 'message': f'Возврат {amount}₽ выполнен успешно', 'refund_id': refund_result.get('id') if refund_result else None})
    except Exception as e:
        logger.error(f'Error refunding transaction {transaction_id}: {e}')
        return (jsonify({'success': False, 'error': str(e)}), 500)
    finally:
        conn.close()

@app.route('/api/panel/users/<int:user_id>/subscriptions', methods=['GET'])

@require_auth

def get_user_subscriptions(user_id: int):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT telegram_id FROM users WHERE id = ?', (user_id,))
        user_row = cursor.fetchone()
        telegram_id = user_row['telegram_id'] if user_row else None
        cursor.execute("\n            SELECT vk.id, vk.key_uuid, vk.status, vk.expiry_date, \n                   vk.traffic_used, vk.traffic_limit, vk.created_at,\n                   'vpn' as type\n            FROM vpn_keys vk\n            WHERE vk.user_id = ?\n            ORDER BY vk.created_at DESC\n        ", (user_id,))
        rows = cursor.fetchall()
        remnawave_traffic = {}
        if telegram_id:
            try:
                rw_users = remnawave.remnawave_api.get_user_by_telegram_id(telegram_id)
                for rw_user in rw_users:
                    if hasattr(rw_user, 'uuid'):
                        traffic_used = 0
                        if hasattr(rw_user, 'user_traffic') and rw_user.user_traffic:
                            traffic_used = rw_user.user_traffic.used_traffic_bytes
                        elif hasattr(rw_user, 'used_traffic_bytes'):
                            traffic_used = rw_user.used_traffic_bytes
                        remnawave_traffic[rw_user.uuid] = traffic_used
            except Exception as e:
                logger.warning(f'Failed to sync traffic from Remnawave: {e}')
        subscriptions = []
        for row in rows:
            days_left = 0
            hours_left = 0
            is_expired = False
            if row['expiry_date']:
                try:
                    if isinstance(row['expiry_date'], str):
                        expiry_dt = datetime.fromisoformat(row['expiry_date'].replace('Z', '+00:00'))
                    else:
                        expiry_dt = row['expiry_date']
                    if expiry_dt.tzinfo:
                        expiry_dt = expiry_dt.replace(tzinfo=None)
                    diff = expiry_dt - datetime.now()
                    total_seconds = diff.total_seconds()
                    if total_seconds <= 0:
                        is_expired = True
                        days_left = 0
                        hours_left = 0
                    else:
                        import math
                        total_hours = total_seconds / 3600
                        days_left = int(total_hours / 24)
                        hours_left = int(math.ceil(total_hours % 24))
                except:
                    is_expired = True
            traffic_used = float(row['traffic_used'] or 0)
            key_uuid = row['key_uuid']
            if key_uuid and key_uuid in remnawave_traffic:
                traffic_used = float(remnawave_traffic[key_uuid])
                try:
                    cursor.execute('UPDATE vpn_keys SET traffic_used = ? WHERE key_uuid = ?', (traffic_used, key_uuid))
                except:
                    pass
            subscriptions.append({'id': row['id'], 'key_uuid': row['key_uuid'], 'short_uuid': row['key_uuid'][:8] if row['key_uuid'] else None, 'status': row['status'], 'expiry_date': row['expiry_date'], 'days_left': days_left if days_left is not None else 0, 'traffic_used': traffic_used, 'traffic_limit': float(row['traffic_limit'] or 0), 'type': row['type']})
        try:
            conn.commit()
        except:
            pass
        return jsonify(subscriptions)
    finally:
        conn.close()

@app.route('/api/panel/users/<int:user_id>/unban', methods=['POST'])

@require_auth

def unban_user(user_id: int):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT id, telegram_id, username, is_banned FROM users WHERE id = ?', (user_id,))
        user = cursor.fetchone()
        if not user:
            return (jsonify({'success': False, 'error': 'Пользователь не найден'}), 404)
        telegram_id = user['telegram_id']
        cursor.execute('SELECT 1 FROM blacklist WHERE telegram_id = ?', (telegram_id,))
        in_blacklist = cursor.fetchone() is not None
        if not user['is_banned'] and (not in_blacklist):
            return (jsonify({'success': False, 'error': 'Пользователь не заблокирован'}), 400)
        cursor.execute('UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?', (user_id,))
        if in_blacklist:
            cursor.execute('DELETE FROM blacklist WHERE telegram_id = ?', (telegram_id,))
            logger.info(f'User {user_id} (telegram_id={telegram_id}) removed from blacklist')
        conn.commit()
        if telegram_id:
            core.send_notification_to_user(telegram_id, '✅ Ваш аккаунт разблокирован! Вы снова можете пользоваться сервисом.')
        logger.info(f'User {user_id} unbanned successfully')
        return jsonify({'success': True, 'message': f"Пользователь @{user['username'] or user_id} разблокирован", 'was_blacklisted': in_blacklist})
    except Exception as e:
        logger.error(f'Error unbanning user {user_id}: {e}')
        return (jsonify({'success': False, 'error': str(e)}), 500)
    finally:
        conn.close()

@app.route('/api/panel/users/<int:user_id>/referrals', methods=['GET'])

@require_auth

def get_panel_user_referrals(user_id: int):
    cursor_user = database.get_user_by_id(user_id)
    if not cursor_user:
        return (jsonify({'error': 'User not found'}), 404)
    referred = database.get_users_referred_by(user_id)
    return jsonify({'count': len(referred), 'referrals': referred, 'referrer': {'id': user_id, 'telegram_id': cursor_user.get('telegram_id'), 'username': cursor_user.get('username')}})

@app.route('/api/panel/users/<int:user_id>/delete-referrals', methods=['POST'])

@require_auth

def delete_panel_user_referrals(user_id: int):
    data = request.get_json() or {}
    confirm_phrase = (data.get('confirm_phrase') or '').strip()
    confirm_telegram_id = data.get('confirm_telegram_id')
    referrer = database.get_user_by_id(user_id)
    if not referrer:
        return (jsonify({'error': 'User not found'}), 404)
    expected_phrase = 'УДАЛИТЬ РЕФЕРАЛОВ'
    if confirm_phrase != expected_phrase:
        return (jsonify({'error': f'Неверная фраза подтверждения. Введите: {expected_phrase}'}), 400)
    try:
        confirm_tid = int(confirm_telegram_id)
    except (TypeError, ValueError):
        return (jsonify({'error': 'Укажите Telegram ID реферера для подтверждения'}), 400)
    if confirm_tid != int(referrer['telegram_id']):
        return (jsonify({'error': 'Telegram ID не совпадает с пользователем'}), 400)
    referred = database.get_users_referred_by(user_id)
    if not referred:
        return jsonify({'success': True, 'deleted_count': 0, 'message': 'Нет рефералов для удаления'})
    deleted_ids = []
    errors = []
    for ref_user in referred:
        ref_id = ref_user['id']
        try:
            key_uuids = []
            conn = database.get_db_connection()
            cur = conn.cursor()
            try:
                cur.execute('SELECT key_uuid FROM vpn_keys WHERE user_id = ?', (ref_id,))
                key_uuids = [r['key_uuid'] for r in cur.fetchall() if r['key_uuid']]
            finally:
                conn.close()
            for ku in key_uuids:
                try:
                    remnawave.remnawave_api.delete_user_sync(ku)
                except Exception as e:
                    logger.warning(f'Remnawave delete failed for {ku}: {e}')
            database.purge_user_from_database(ref_id)
            deleted_ids.append(ref_id)
            logger.info(f'Purged referred user {ref_id} (referrer {user_id})')
        except Exception as e:
            logger.error(f'Failed to purge referred user {ref_id}: {e}')
            errors.append({'user_id': ref_id, 'error': str(e)})
    return jsonify({'success': len(errors) == 0, 'deleted_count': len(deleted_ids), 'deleted_user_ids': deleted_ids, 'errors': errors, 'message': f'Удалено рефералов: {len(deleted_ids)} из {len(referred)}'})

@app.route('/api/panel/keys', methods=['GET'])

@require_auth

def get_keys():
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT \n                vk.id,\n                vk.user_id,\n                u.username,\n                u.telegram_id,\n                vk.key_uuid,\n                vk.key_config,\n                vk.status,\n                vk.expiry_date,\n                vk.traffic_used,\n                vk.traffic_limit,\n                vk.devices_limit,\n                vk.server_location,\n                vk.created_at\n            FROM vpn_keys vk\n            LEFT JOIN users u ON vk.user_id = u.id\n            ORDER BY vk.created_at DESC\n            LIMIT ? OFFSET ?\n        ', (limit, offset))
        rows = cursor.fetchall()
        keys = []
        telegram_ids = set()
        for row in rows:
            if row['telegram_id']:
                telegram_ids.add(row['telegram_id'])
        remnawave_traffic = {}
        try:
            for telegram_id in telegram_ids:
                rw_users = remnawave.remnawave_api.get_user_by_telegram_id(telegram_id)
                for rw_user in rw_users:
                    if hasattr(rw_user, 'uuid'):
                        traffic_used = 0
                        if hasattr(rw_user, 'user_traffic') and rw_user.user_traffic:
                            traffic_used = rw_user.user_traffic.used_traffic_bytes
                        elif hasattr(rw_user, 'used_traffic_bytes'):
                            traffic_used = rw_user.used_traffic_bytes
                        remnawave_traffic[rw_user.uuid] = traffic_used
        except Exception as e:
            logger.warning(f'Failed to sync traffic from Remnawave for panel keys: {e}')
        for row in rows:
            username = row['username'] or f"user_{row['user_id']}"
            key_display = row['key_config'] or row['key_uuid'] or f"key_{row['id']}"
            if len(key_display) > 50:
                key_display = key_display[:47] + '...'
            expiry_days = 0
            if row['expiry_date']:
                try:
                    from datetime import datetime
                    if isinstance(row['expiry_date'], str):
                        expiry = datetime.fromisoformat(row['expiry_date'].replace('Z', '+00:00'))
                    else:
                        expiry = row['expiry_date']
                    now = datetime.now()
                    if expiry.tzinfo:
                        from datetime import timezone
                        now = datetime.now(timezone.utc)
                    diff = expiry - now
                    expiry_days = max(0, int(diff.total_seconds() / 86400))
                except:
                    expiry_days = 0
            traffic_used = float(row['traffic_used'] or 0)
            key_uuid = row['key_uuid']
            if key_uuid and key_uuid in remnawave_traffic:
                traffic_used = float(remnawave_traffic[key_uuid])
                try:
                    cursor.execute('UPDATE vpn_keys SET traffic_used = ? WHERE key_uuid = ?', (traffic_used, key_uuid))
                except:
                    pass
            keys.append({'id': row['id'], 'key_config': row['key_config'], 'key_uuid': row['key_uuid'], 'key': key_display, 'user_id': row['user_id'], 'username': f'@{username}' if username and (not username.startswith('@')) else username, 'status': row['status'] or 'Active', 'expiry_date': row['expiry_date'], 'expiry': expiry_days, 'traffic_used': traffic_used, 'traffic_limit': float(row['traffic_limit'] or 0), 'devices_used': 0, 'devices_limit': row['devices_limit'] or 1, 'server_location': row['server_location'] or 'Unknown'})
        try:
            conn.commit()
        except:
            pass
        return jsonify(keys)
    finally:
        conn.close()

@app.route('/api/panel/keys', methods=['POST'])

@require_auth

def create_key():
    data = request.json
    user_id = data.get('user_id')
    days = data.get('days', 30)
    traffic_gb = data.get('traffic', 100)
    devices = data.get('devices', 5)
    is_trial = data.get('is_trial', False)
    plan_type = data.get('plan_type', 'vpn')
    squad_uuids = data.get('squads')
    if squad_uuids is None or len(squad_uuids) == 0:
        best_squad = database.get_best_squad_for_subscription(plan_type)
        if best_squad:
            squad_uuids = [best_squad['squad_uuid']]
            logger.info(f"Balancer selected squad {best_squad['squad_name']} for {plan_type} (users: {best_squad['current_users']})")
        else:
            squad_uuids = database.get_default_squads(plan_type)
            logger.info(f'Using default squads for {plan_type}: {squad_uuids}')
    if not user_id:
        return (jsonify({'error': 'user_id обязателен'}), 400)
    user = database.get_user_by_id(user_id)
    if not user:
        return (jsonify({'error': 'Пользователь не найден'}), 404)
    telegram_id = user.get('telegram_id')
    raw_username = user.get('username') or f'user_{telegram_id}'
    import re
    username = re.sub('[^a-zA-Z0-9_-]', '', raw_username)
    if not username:
        username = f'user_{telegram_id}'
    if username[0] in '_-':
        username = f'u{username}'
    if is_trial:
        days = 1
        traffic_gb = 5
        devices = 1
    traffic_bytes = int(traffic_gb * 1024 ** 3)
    try:
        from backend.api import remnawave
        remnawave_user = None
        existing_users = remnawave.remnawave_api.get_user_by_telegram_id(telegram_id)
        if existing_users and len(existing_users) > 0:
            remnawave_user = existing_users[0]
            expire_at = datetime.now() + timedelta(days=days)
            logger.info(f'Updating Remnawave user {remnawave_user.uuid} with squads: {squad_uuids}')
            updated_user = remnawave.remnawave_api.update_user_sync(uuid=remnawave_user.uuid, expire_at=expire_at, traffic_limit_bytes=traffic_bytes, hwid_device_limit=devices, active_internal_squads=squad_uuids if squad_uuids else None)
            remnawave_user = updated_user
        else:
            logger.info(f'Creating Remnawave user {username} with squads: {squad_uuids}')
            try:
                remnawave_user = remnawave.remnawave_api.create_user_with_params(telegram_id=telegram_id, username=username, days=days, traffic_limit_bytes=traffic_bytes, hwid_device_limit=devices, active_internal_squads=squad_uuids if squad_uuids else None)
            except Exception as create_error:
                error_msg = str(create_error).lower()
                if 'already exists' in error_msg or 'a019' in error_msg:
                    unique_username = f'{username}_{telegram_id}'
                    logger.info(f'Username {username} already exists, trying {unique_username}')
                    remnawave_user = remnawave.remnawave_api.create_user_with_params(telegram_id=telegram_id, username=unique_username, days=days, traffic_limit_bytes=traffic_bytes, hwid_device_limit=devices, active_internal_squads=squad_uuids if squad_uuids else None)
                else:
                    raise create_error
        if not remnawave_user:
            return (jsonify({'error': 'Не удалось создать пользователя в Remnawave'}), 500)
        conn = database.get_db_connection()
        cursor = conn.cursor()
        expiry_date = format_datetime_msk(datetime.now() + timedelta(days=days))
        key_uuid = remnawave_user.uuid if hasattr(remnawave_user, 'uuid') else remnawave_user.get('uuid')
        subscription_url = remnawave_user.subscription_url if hasattr(remnawave_user, 'subscription_url') else remnawave_user.get('subscription_url', '')
        cursor.execute('SELECT id FROM vpn_keys WHERE user_id = ? AND key_uuid = ?', (user_id, key_uuid))
        existing_key = cursor.fetchone()
        if existing_key:
            cursor.execute("\n                UPDATE vpn_keys\n                SET status = 'Active', expiry_date = ?, traffic_limit = ?, devices_limit = ?, \n                    key_config = ?\n                WHERE id = ?\n            ", (expiry_date, traffic_bytes, devices, subscription_url, existing_key['id']))
            key_id = existing_key['id']
        else:
            cursor.execute("\n                INSERT INTO vpn_keys (user_id, key_uuid, key_config, status, expiry_date, \n                                    devices_limit, traffic_limit, plan_type)\n                VALUES (?, ?, ?, 'Active', ?, ?, ?, ?)\n            ", (user_id, key_uuid, subscription_url, expiry_date, devices, traffic_bytes, plan_type))
            key_id = cursor.lastrowid
        conn.commit()
        conn.close()
        core.send_key_created_notification(telegram_id, days, traffic_gb, devices)
        return (jsonify({'success': True, 'key_id': key_id, 'key_uuid': key_uuid, 'subscription_url': subscription_url, 'expiry_date': expiry_date}), 201)
    except Exception as e:
        logger.error(f'Ошибка создания ключа: {e}')
        import traceback
        traceback.print_exc()
        return (jsonify({'error': f'Ошибка создания ключа: {str(e)}'}), 500)

@app.route('/api/panel/keys/<int:key_id>/block', methods=['POST'])

@require_auth

def toggle_key_block(key_id):
    data = request.json
    blocked = data.get('blocked', True)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        new_status = 'Blocked' if blocked else 'Active'
        cursor.execute('\n            UPDATE vpn_keys \n            SET status = ?, last_used = CURRENT_TIMESTAMP\n            WHERE id = ?\n        ', (new_status, key_id))
        if cursor.rowcount == 0:
            return (jsonify({'error': 'Ключ не найден'}), 404)
        conn.commit()
        cursor.execute('SELECT key_uuid FROM vpn_keys WHERE id = ?', (key_id,))
        row = cursor.fetchone()
        if row and row['key_uuid']:
            try:
                from backend.api.remnawave import UserStatus
                status = UserStatus.DISABLED if blocked else UserStatus.ACTIVE
                remnawave.remnawave_api.update_user_sync(uuid=row['key_uuid'], status=status)
                logger.info(f"Key {key_id} {('blocked' if blocked else 'unblocked')} in Remnawave")
            except Exception as e:
                logger.error(f'Failed to update key status in Remnawave: {e}')
        return jsonify({'success': True, 'key_id': key_id, 'status': new_status, 'blocked': blocked})
    except Exception as e:
        logger.error(f'Error toggling key block: {e}')
        return (jsonify({'error': str(e)}), 500)
    finally:
        conn.close()

@app.route('/api/panel/keys/<int:key_id>', methods=['DELETE'])

@require_auth

def delete_key(key_id: int):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT key_uuid, user_id FROM vpn_keys WHERE id = ?', (key_id,))
        row = cursor.fetchone()
        if not row:
            return (jsonify({'error': 'Ключ не найден'}), 404)
        key_uuid = row['key_uuid']
        user_id = row['user_id']
        if key_uuid:
            try:
                remnawave.remnawave_api.delete_user_sync(key_uuid)
                logger.info(f'Deleted key {key_uuid} from Remnawave')
            except Exception as e:
                logger.error(f'Failed to delete key {key_uuid} from Remnawave: {e}')
        cursor.execute('DELETE FROM vpn_keys WHERE id = ?', (key_id,))
        conn.commit()
        cursor.execute('SELECT telegram_id FROM users WHERE id = ?', (user_id,))
        user_row = cursor.fetchone()
        if user_row:
            core.send_notification_to_user(user_row['telegram_id'], '🗑 Ваша VPN подписка была удалена администратором.')
        logger.info(f'Key {key_id} deleted from panel')
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f'Error deleting key {key_id}: {e}')
        return (jsonify({'error': str(e)}), 500)
    finally:
        conn.close()

@app.route('/api/panel/keys/<int:key_id>', methods=['PUT'])

@require_auth

def update_key(key_id: int):
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT key_uuid, expiry_date, traffic_limit, devices_limit FROM vpn_keys WHERE id = ?', (key_id,))
        row = cursor.fetchone()
        if not row:
            return (jsonify({'error': 'Ключ не найден'}), 404)
        key_uuid = row['key_uuid']
        new_expiry_days = data.get('expiry_days')
        new_traffic_gb = data.get('traffic_gb')
        new_devices = data.get('devices_limit')
        updates = []
        values = []
        if new_expiry_days is not None:
            new_expiry_date = format_datetime_msk(datetime.now() + timedelta(days=int(new_expiry_days)))
            updates.append('expiry_date = ?')
            values.append(new_expiry_date)
        if new_traffic_gb is not None:
            traffic_bytes = int(float(new_traffic_gb) * 1024 ** 3)
            updates.append('traffic_limit = ?')
            values.append(traffic_bytes)
        if new_devices is not None:
            updates.append('devices_limit = ?')
            values.append(int(new_devices))
        if updates:
            values.append(key_id)
            cursor.execute(f"UPDATE vpn_keys SET {', '.join(updates)} WHERE id = ?", tuple(values))
            conn.commit()
        if key_uuid:
            try:
                update_params = {'uuid': key_uuid}
                if new_expiry_days is not None:
                    update_params['expire_at'] = datetime.now() + timedelta(days=int(new_expiry_days))
                if new_traffic_gb is not None:
                    update_params['traffic_limit_bytes'] = int(float(new_traffic_gb) * 1024 ** 3)
                if new_devices is not None:
                    update_params['hwid_device_limit'] = int(new_devices)
                remnawave.remnawave_api.update_user_sync(**update_params)
                logger.info(f'Updated key {key_uuid} in Remnawave')
            except Exception as e:
                logger.error(f'Failed to update key {key_uuid} in Remnawave: {e}')
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f'Error updating key {key_id}: {e}')
        return (jsonify({'error': str(e)}), 500)
    finally:
        conn.close()

@app.route('/api/user/referrals', methods=['GET'])

def get_user_referrals():
    telegram_id = request.args.get('telegram_id', type=int)
    if not telegram_id:
        return (jsonify({'error': 'telegram_id required'}), 400)
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT id, username, full_name, registration_date\n            FROM users\n            WHERE referred_by = ?\n            ORDER BY registration_date DESC\n            ', (user['id'],))
        referrals_rows = cursor.fetchall()
        rate = user.get('partner_rate', 20) / 100
        referrals = []
        for r in referrals_rows:
            ref_id = r['id']
            cursor.execute("\n                SELECT COALESCE(SUM(ABS(amount)), 0) as total\n                FROM transactions\n                WHERE user_id = ? AND type IN ('subscription', 'trial')\n                ", (ref_id,))
            spent_row = cursor.fetchone()
            total_spent = float(spent_row['total'] or 0)
            cursor.execute("\n                SELECT COALESCE(SUM(amount), 0) as total\n                FROM transactions\n                WHERE user_id = ? AND type = 'referral_income' \n                AND description LIKE ?\n                ", (user['id'], f"%реферала%{r['username'] or ref_id}%"))
            income_row = cursor.fetchone()
            my_profit = float(income_row['total'] or 0)
            if my_profit == 0 and total_spent > 0:
                my_profit = total_spent * rate
            cursor.execute("\n                SELECT type, amount, created_at, description\n                FROM transactions\n                WHERE user_id = ? AND type IN ('subscription', 'trial')\n                ORDER BY created_at DESC\n                LIMIT 5\n                ", (ref_id,))
            history_rows = cursor.fetchall()
            history = []
            for h in history_rows:
                amount = abs(float(h['amount'] or 0))
                trans_type = h['type']
                description = h['description'] or ''
                if trans_type == 'subscription':
                    title = f'Покупка подписки: {round(amount, 2)}₽'
                elif trans_type == 'trial':
                    title = 'Активация пробного периода'
                else:
                    title = description or f'Транзакция: {round(amount, 2)}₽'
                referrer_income = round(amount * rate, 2)
                history.append({'type': trans_type, 'title': title, 'amount': round(amount, 2), 'income': referrer_income, 'date': h['created_at'] or ''})
            referrals.append({'id': ref_id, 'name': r['full_name'] or r['username'] or f'id{ref_id}', 'date': r['registration_date'] or '', 'spent': round(total_spent, 2), 'myProfit': round(my_profit, 2), 'history': history})
        return jsonify(referrals)
    finally:
        conn.close()

@app.route('/api/user/referral-history', methods=['GET'])

def get_referral_income_history():
    telegram_id = request.args.get('telegram_id', type=int)
    if not telegram_id:
        return (jsonify({'error': 'telegram_id required'}), 400)
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("\n            SELECT id, type, amount, status, description, created_at\n            FROM transactions\n            WHERE user_id = ? AND type IN ('referral_income', 'transfer', 'withdrawal_request')\n            ORDER BY created_at DESC\n            LIMIT 50\n        ", (user['id'],))
        rows = cursor.fetchall()
        history = []
        for row in rows:
            trans_type = row['type']
            amount = round(float(row['amount'] or 0), 2)
            description = row['description'] or ''
            if trans_type == 'referral_income':
                title = f'💰 Реферальный доход: +{amount}₽'
                icon = 'income'
            elif trans_type == 'transfer':
                title = f'🔄 Перевод на баланс: {amount}₽'
                icon = 'transfer'
            else:
                title = f'💸 Заявка на вывод: {amount}₽'
                icon = 'withdrawal'
            history.append({'id': row['id'], 'type': icon, 'title': title, 'amount': amount, 'status': row['status'], 'description': description, 'date': row['created_at']})
        return jsonify(history)
    finally:
        conn.close()

@app.route('/api/user/withdraw', methods=['POST'])

def request_withdrawal():
    data = request.json
    telegram_id = data.get('telegram_id')
    amount = data.get('amount', 0)
    method = data.get('method')
    phone = data.get('phone', '')
    bank = data.get('bank', '')
    crypto_net = data.get('crypto_net', '')
    crypto_addr = data.get('crypto_addr', '')
    logger.info(f'Withdrawal request: telegram_id={telegram_id}, amount={amount}, method={method}')
    if not telegram_id or not method:
        return (jsonify({'error': 'Missing required fields'}), 400)
    auth_err = assert_telegram_identity(telegram_id)
    if auth_err:
        return auth_err
    try:
        amount = float(amount)
    except (ValueError, TypeError):
        return (jsonify({'error': 'Invalid amount'}), 400)
    if amount <= 0:
        return (jsonify({'error': 'Invalid amount'}), 400)
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    ban_status = abuse_detected.check_user_ban_status(user['id'], telegram_id)
    if ban_status.get('banned'):
        return (jsonify({'error': 'Аккаунт заблокирован'}), 403)
    partner_balance = float(user.get('partner_balance', 0) or 0)
    if amount > partner_balance:
        return (jsonify({'error': 'Недостаточно средств на реферальном балансе'}), 400)
    if method in ('ton_usdt', 'card', 'crypto'):
        amount = round(amount, 2)
        if not database.validate_partner_withdraw_amount(amount):
            return (jsonify({'error': f'Максимальная сумма вывода — {database.PARTNER_WITHDRAW_MAX_RUB}₽'}), 400)
        cooldown = database.get_partner_withdrawal_cooldown(user['id'])
        if cooldown:
            hours_left = max(1, (cooldown['seconds_left'] + 3599) // 3600)
            return (jsonify({'error': f'Вывод доступен не чаще 1 раза в 24 часа. Попробуйте через {hours_left} ч.'}), 429)
    if method == 'ton_usdt':
        from backend.ton.transfer import is_ton_recipient_format, resolve_ton_recipient, rub_to_usdt, rub_to_usdt_micro, send_usdt_on_ton
        if amount < 10:
            return (jsonify({'error': 'Минимальная сумма вывода — 10₽'}), 400)
        partner_balance = float(user.get('partner_balance', 0) or 0)
        if amount > partner_balance + 0.001:
            return (jsonify({'error': 'Недостаточно средств на реферальном балансе'}), 400)
        wallet_raw = (crypto_addr or '').strip()
        net = (crypto_net or '').strip().upper()
        if net != 'TON':
            return (jsonify({'error': 'Поддерживается только сеть TON'}), 400)
        if not is_ton_recipient_format(wallet_raw):
            return (jsonify({'error': 'Некорректный адрес или домен (UQ/EQ, .ton, .t.me, @username)'}), 400)
        wallet_addr = resolve_ton_recipient(wallet_raw)
        if not wallet_addr:
            return (jsonify({'error': 'Не удалось определить TON-кошелёк. Проверьте адрес или домен'}), 400)
        try:
            usdt_amount = rub_to_usdt(amount)
            usdt_micro = rub_to_usdt_micro(amount)
        except ValueError:
            return (jsonify({'error': 'Сумма вывода вне допустимого диапазона'}), 400)
        if usdt_micro < 1:
            return (jsonify({'error': 'Сумма слишком мала для конвертации в USDT'}), 400)
        description = f'Вывод {amount}₽ в USDT (TON). Получатель: {wallet_raw} → {wallet_addr}. Курс: 85₽ = 1$. Получит: {usdt_amount} USDT'
        transaction_id, prep_err = database.prepare_ton_withdrawal(user['id'], amount, description)
        if prep_err == 'rate_limit':
            return (jsonify({'error': 'Вывод доступен не чаще 1 раза в 24 часа'}), 429)
        if prep_err == 'invalid_amount':
            return (jsonify({'error': f'Максимальная сумма вывода — {database.PARTNER_WITHDRAW_MAX_RUB}₽'}), 400)
        if prep_err == 'insufficient':
            return (jsonify({'error': 'Недостаточно средств на реферальном балансе'}), 400)
        if prep_err or not transaction_id:
            return (jsonify({'error': 'Не удалось создать заявку на вывод'}), 500)
        success, transfer_msg = send_usdt_on_ton(wallet_raw, usdt_micro, expected_address=wallet_addr)
        username = user.get('username', 'N/A')
        safe_msg = str(transfer_msg).replace('<', '').replace('>', '')[:500]
        conn = database.get_db_connection()
        cursor = conn.cursor()
        try:
            if success:
                cursor.execute("UPDATE transactions SET status = 'Success' WHERE id = ?", (transaction_id,))
                conn.commit()
                core.send_formatted_notification(telegram_id, f'✅ <b>Вывод выполнен</b>\n\nСумма: {amount}₽\nПолучено: {usdt_amount} USDT\nСеть: TON\nКошелёк: <code>{wallet_addr}</code>')
                return jsonify({'success': True, 'message': f'Вывод {usdt_amount} USDT отправлен на ваш кошелёк', 'usdt_amount': usdt_amount})
            cursor.execute("UPDATE transactions SET status = 'Failed' WHERE id = ?", (transaction_id,))
            conn.commit()
            admin_msg = f'⚠️ <b>Автовывод USDT не удался</b>\n\n🆔 Заявка: #{transaction_id}\n👤 @{username} ({telegram_id})\n💵 {amount}₽ → {usdt_amount} USDT\n🌐 Сеть: TON\n📝 Кошелёк: <code>{wallet_addr}</code>\n❗ Ошибка: {safe_msg}\n\nСредства уже списаны с баланса пользователя. Отправьте вручную.'
            core.send_notification_to_admin(admin_msg)
            core.send_formatted_notification(telegram_id, f'⚠️ <b>Вывод зарегистрирован</b>\n\nСумма {amount}₽ ({usdt_amount} USDT) списана с баланса.\nАвтоматическая отправка не удалась — средства будут отправлены вручную.\nКошелёк: <code>{wallet_addr}</code>')
            return jsonify({'success': True, 'pending_manual': True, 'message': f'Заявка на вывод {amount}₽ ({usdt_amount} USDT) принята. Средства будут отправлены вручную.', 'usdt_amount': usdt_amount})
        except Exception as e:
            conn.rollback()
            logger.error(f'TON withdrawal status update error: {e}')
            core.send_notification_to_admin(f'⚠️ Ошибка обновления статуса вывода #{transaction_id} для user {telegram_id}: {e}')
            return (jsonify({'error': 'Ошибка обработки вывода'}), 500)
        finally:
            conn.close()
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        if method == 'balance':
            cursor.execute('\n                UPDATE users \n                SET balance = balance + ?, partner_balance = partner_balance - ?\n                WHERE id = ?\n            ', (amount, amount, user['id']))
            cursor.execute("\n                INSERT INTO transactions (user_id, type, amount, status, description)\n                VALUES (?, 'transfer', ?, 'Success', 'Перевод с реферального баланса на основной')\n            ", (user['id'], amount))
            conn.commit()
            conn.close()
            return jsonify({'success': True, 'message': f'Переведено {amount}₽ на основной баланс'})
        elif method in ('card', 'crypto'):
            amount = round(amount, 2)
            if method == 'card' and amount < 200:
                conn.close()
                return (jsonify({'error': 'Минимальная сумма вывода — 200₽'}), 400)
            if method == 'card':
                description = f'Заявка на вывод {amount}₽ на карту. Банк: {bank}, Телефон: {phone}'
                details = f'🏦 Банк: {bank}\n📱 Телефон: {phone}'
                payment_method = 'Карта'
            else:
                description = f'Заявка на вывод {amount}₽ в криптовалюте. Сеть: {crypto_net}, Адрес: {crypto_addr}'
                details = f'🌐 Сеть: {crypto_net}\n📝 Адрес: {crypto_addr}'
                payment_method = 'Crypto'
            transaction_id, prep_err = database.prepare_partner_withdrawal(user['id'], amount, description, payment_method)
            if prep_err == 'rate_limit':
                conn.close()
                return (jsonify({'error': 'Вывод доступен не чаще 1 раза в 24 часа'}), 429)
            if prep_err == 'invalid_amount':
                conn.close()
                return (jsonify({'error': f'Максимальная сумма вывода — {database.PARTNER_WITHDRAW_MAX_RUB}₽'}), 400)
            if prep_err == 'insufficient':
                conn.close()
                return (jsonify({'error': 'Недостаточно средств на реферальном балансе'}), 400)
            if prep_err or not transaction_id:
                conn.close()
                return (jsonify({'error': 'Не удалось создать заявку на вывод'}), 500)
            username = user.get('username', 'N/A')
            method_name = 'Банковская карта' if method == 'card' else 'Криптовалюта'
            core.send_withdrawal_request_to_admin(transaction_id=transaction_id, user_id=user['id'], telegram_id=telegram_id, username=username, amount=amount, method=method_name, details=details)
            conn.close()
            return jsonify({'success': True, 'message': f'Заявка на вывод {amount}₽ создана. Ожидайте обработки.'})
        else:
            conn.close()
            return (jsonify({'error': f'Unknown withdrawal method: {method}'}), 400)
    except Exception as e:
        logger.error(f'Error processing withdrawal request: {e}')
        conn.close()
        return (jsonify({'error': str(e)}), 500)

@app.route('/api/panel/stats/charts', methods=['GET'])

@require_auth

def get_stats_charts():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    from datetime import datetime, timedelta
    try:
        days = []
        today = datetime.utcnow().date()
        for i in range(14):
            days.append(today - timedelta(days=13 - i))
        cursor.execute('\n            SELECT DATE(registration_date) as d, COUNT(*) as cnt\n            FROM users\n            GROUP BY DATE(registration_date)\n            ')
        users_map = {row['d']: row['cnt'] for row in cursor.fetchall()}
        users_series = [users_map.get(str(d), 0) for d in days]
        cursor.execute('\n            SELECT DATE(created_at) as d, COUNT(*) as cnt\n            FROM vpn_keys\n            GROUP BY DATE(created_at)\n            ')
        keys_map = {row['d']: row['cnt'] for row in cursor.fetchall()}
        keys_series = [keys_map.get(str(d), 0) for d in days]
        return jsonify({'users': users_series, 'keys': keys_series, 'labels': [d.strftime('%d.%m') for d in days]})
    finally:
        conn.close()

@app.route('/api/panel/stats/summary', methods=['GET'])

@require_auth

def get_stats_summary():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    from datetime import datetime
    try:
        cursor.execute('SELECT COUNT(*) AS cnt FROM users')
        total_users = cursor.fetchone()['cnt'] or 0
        cursor.execute("SELECT COUNT(*) AS cnt FROM vpn_keys WHERE status = 'Active'")
        active_keys = cursor.fetchone()['cnt'] or 0
        now = datetime.utcnow()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        cursor.execute("\n            SELECT COALESCE(SUM(amount), 0) AS total\n            FROM transactions\n            WHERE type = 'deposit'\n              AND created_at >= ?\n              AND status = 'Success'\n            ", (month_start.isoformat(),))
        monthly_revenue = float(cursor.fetchone()['total'] or 0)
        return jsonify({'total_users': total_users, 'active_keys': active_keys, 'monthly_revenue': monthly_revenue})
    finally:
        conn.close()

@app.route('/api/panel/finance/stats', methods=['GET'])

@require_auth

def get_finance_stats():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    from datetime import datetime, timedelta
    try:
        cursor.execute("\n            SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt\n            FROM transactions\n            WHERE type = 'deposit' AND status = 'Success'\n        ")
        deposits_row = cursor.fetchone()
        deposits_total = float(deposits_row['total'] or 0)
        deposits_count = deposits_row['cnt'] or 0
        cursor.execute("\n            SELECT COALESCE(SUM(ABS(amount)), 0) AS total, COUNT(*) AS cnt\n            FROM transactions\n            WHERE type IN ('referral_withdrawal', 'refund', 'withdrawal', 'admin_withdrawal') \n              AND status = 'Success'\n        ")
        withdrawals_row = cursor.fetchone()
        withdrawals_total = float(withdrawals_row['total'] or 0)
        withdrawals_count = withdrawals_row['cnt'] or 0
        cursor.execute("\n            SELECT COUNT(*) AS cnt\n            FROM transactions\n            WHERE status = 'Success'\n        ")
        successful_ops = cursor.fetchone()['cnt'] or 0
        now = datetime.utcnow()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        prev_month_start = (month_start - timedelta(days=1)).replace(day=1)
        cursor.execute("\n            SELECT COALESCE(SUM(amount), 0) AS total\n            FROM transactions\n            WHERE type = 'deposit' AND status = 'Success'\n              AND created_at >= ? AND created_at < ?\n        ", (prev_month_start.isoformat(), month_start.isoformat()))
        prev_deposits = float(cursor.fetchone()['total'] or 0)
        cursor.execute("\n            SELECT COALESCE(SUM(ABS(amount)), 0) AS total\n            FROM transactions\n            WHERE type IN ('referral_withdrawal', 'refund', 'withdrawal', 'admin_withdrawal')\n              AND status = 'Success'\n              AND created_at >= ? AND created_at < ?\n        ", (prev_month_start.isoformat(), month_start.isoformat()))
        prev_withdrawals = float(cursor.fetchone()['total'] or 0)
        deposits_change = (deposits_total - prev_deposits) / prev_deposits * 100 if prev_deposits > 0 else 0
        withdrawals_change = (withdrawals_total - prev_withdrawals) / prev_withdrawals * 100 if prev_withdrawals > 0 else 0
        return jsonify({'deposits': deposits_total, 'depositsChange': f'+{deposits_change:.1f}%' if deposits_change >= 0 else f'{deposits_change:.1f}%', 'withdrawals': withdrawals_total, 'withdrawalsChange': f'+{withdrawals_change:.1f}%' if withdrawals_change >= 0 else f'{withdrawals_change:.1f}%', 'successfulOps': successful_ops})
    finally:
        conn.close()

@app.route('/api/panel/statistics/full', methods=['GET'])

@require_auth

def get_full_statistics():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    from datetime import datetime, timedelta
    period = request.args.get('period', '30')
    period_days = {'7': 7, '30': 30, '365': 365}.get(str(period), 30)
    try:
        cursor.execute('SELECT COUNT(*) AS cnt FROM users')
        total_users = cursor.fetchone()['cnt'] or 0
        cursor.execute("SELECT COUNT(*) AS cnt FROM vpn_keys WHERE status = 'Active'")
        active_subscriptions = cursor.fetchone()['cnt'] or 0
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        cursor.execute("\n            SELECT COUNT(*) AS cnt FROM transactions\n            WHERE type = 'deposit' AND status = 'Success' AND created_at >= ?\n        ", (today_start.isoformat(),))
        payments_today = cursor.fetchone()['cnt'] or 0
        cursor.execute('SELECT COALESCE(SUM(balance), 0) AS total FROM users')
        clients_balance = float(cursor.fetchone()['total'] or 0)
        revenue_data = []
        revenue_labels = []
        label_fmt = '%d.%m' if period_days <= 30 else '%d.%m.%y'
        for i in range(period_days):
            day = (datetime.utcnow() - timedelta(days=period_days - 1 - i)).date()
            day_start = datetime.combine(day, datetime.min.time())
            day_end = day_start + timedelta(days=1)
            cursor.execute("\n                SELECT COALESCE(SUM(amount), 0) AS total\n                FROM transactions\n                WHERE type = 'deposit' AND status = 'Success'\n                  AND created_at >= ? AND created_at < ?\n            ", (day_start.isoformat(), day_end.isoformat()))
            revenue_data.append(float(cursor.fetchone()['total'] or 0))
            revenue_labels.append(day.strftime(label_fmt))
        cursor.execute("\n            SELECT COUNT(DISTINCT user_id) AS cnt FROM vpn_keys \n            WHERE status = 'Active' AND expiry_date > datetime('now')\n        ")
        active_users = cursor.fetchone()['cnt'] or 0
        cursor.execute('SELECT COUNT(*) AS cnt FROM users WHERE trial_used = 0')
        trial_users = cursor.fetchone()['cnt'] or 0
        cursor.execute('SELECT COUNT(*) AS cnt FROM users WHERE is_banned = 1')
        banned_users = cursor.fetchone()['cnt'] or 0
        cursor.execute("\n            SELECT COUNT(DISTINCT user_id) AS cnt FROM vpn_keys \n            WHERE status = 'Expired' OR (expiry_date IS NOT NULL AND expiry_date < datetime('now'))\n        ")
        expired_users = cursor.fetchone()['cnt'] or 0
        sleeping_users = max(0, total_users - active_users - trial_users - banned_users - expired_users)
        user_dist_data = [{'label': 'Активные', 'value': active_users}, {'label': 'Ушли', 'value': expired_users}, {'label': 'Trial', 'value': trial_users}, {'label': 'Бан', 'value': banned_users}, {'label': 'Спящие', 'value': sleeping_users}]
        cursor.execute("\n            SELECT payment_method, COUNT(*) AS cnt\n            FROM transactions\n            WHERE type = 'deposit' AND status = 'Success'\n            GROUP BY payment_method\n        ")
        payment_methods_raw = cursor.fetchall()
        total_payments = sum((row['cnt'] for row in payment_methods_raw)) or 1
        payment_methods_data = []
        for row in payment_methods_raw:
            method = row['payment_method'] or 'Other'
            count = row['cnt']
            payment_methods_data.append({'label': method, 'value': int(count / total_payments * 100)})
        cursor.execute('SELECT COUNT(*) AS cnt FROM vpn_keys')
        total_subscriptions = cursor.fetchone()['cnt'] or 0
        cursor.execute("SELECT COUNT(*) AS cnt FROM vpn_keys WHERE status = 'Active' AND expiry_date > datetime('now')")
        paid_subscriptions = cursor.fetchone()['cnt'] or 0
        week_start = datetime.utcnow() - timedelta(days=7)
        cursor.execute('\n            SELECT COUNT(*) AS cnt FROM vpn_keys\n            WHERE created_at >= ?\n        ', (week_start.isoformat(),))
        bought_this_week = cursor.fetchone()['cnt'] or 0
        cursor.execute("\n            SELECT COUNT(*) AS cnt FROM vpn_keys\n            WHERE status != 'Deleted'\n              AND (expiry_date IS NULL OR expiry_date < datetime('now'))\n        ")
        expired_subscriptions = cursor.fetchone()['cnt'] or 0
        cursor.execute("\n            SELECT COUNT(DISTINCT vk.user_id) AS cnt FROM vpn_keys vk\n            JOIN users u ON u.id = vk.user_id\n            WHERE vk.status = 'Active' AND vk.expiry_date > datetime('now')\n              AND u.trial_used = 1\n        ")
        trial_active_subscriptions = cursor.fetchone()['cnt'] or 0
        cursor.execute('\n            SELECT COUNT(*) AS cnt FROM vpn_keys\n            WHERE created_at >= ?\n        ', (today_start.isoformat(),))
        new_subscriptions_today = cursor.fetchone()['cnt'] or 0
        cursor.execute("\n            SELECT COUNT(DISTINCT user_id) AS cnt FROM vpn_keys WHERE status != 'Deleted'\n        ")
        users_with_keys = cursor.fetchone()['cnt'] or 0
        avg_subscriptions_per_user = round(total_subscriptions / users_with_keys, 2) if users_with_keys > 0 else 0
        month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        cursor.execute('\n            SELECT COUNT(*) AS cnt FROM vpn_keys WHERE created_at >= ?\n        ', (month_start.isoformat(),))
        bought_this_month = cursor.fetchone()['cnt'] or 0
        plan_distribution = database.get_subscription_plan_distribution()
        cursor.execute('SELECT COUNT(*) AS cnt FROM users WHERE trial_used = 1')
        used_trial = cursor.fetchone()['cnt'] or 0
        cursor.execute("\n            SELECT COUNT(DISTINCT u.id) AS cnt \n            FROM users u\n            JOIN vpn_keys vk ON vk.user_id = u.id\n            WHERE u.trial_used = 1 AND vk.status = 'Active' AND vk.expiry_date > datetime('now')\n        ")
        converted = cursor.fetchone()['cnt'] or 0
        conversion_rate = converted / used_trial * 100 if used_trial > 0 else 0
        cursor.execute('SELECT COUNT(*) AS cnt FROM users WHERE referred_by IS NOT NULL')
        total_invited = cursor.fetchone()['cnt'] or 0
        cursor.execute('SELECT COUNT(*) AS cnt FROM users WHERE is_partner = 1')
        partners = cursor.fetchone()['cnt'] or 0
        cursor.execute('SELECT COALESCE(SUM(total_earned), 0) AS total FROM users')
        total_paid = float(cursor.fetchone()['total'] or 0)
        cursor.execute("\n            SELECT u.id, u.username, u.partner_rate,\n                   COALESCE(refs.referrals_count, 0) AS referrals_count,\n                   COALESCE(spent.total_spent, 0) AS total_spent\n            FROM users u\n            LEFT JOIN (\n                SELECT referred_by AS referrer_id, COUNT(*) AS referrals_count\n                FROM users\n                WHERE referred_by IS NOT NULL\n                GROUP BY referred_by\n            ) refs ON refs.referrer_id = u.id\n            LEFT JOIN (\n                SELECT r.referred_by AS referrer_id, COALESCE(SUM(t.amount), 0) AS total_spent\n                FROM users r\n                JOIN transactions t ON t.user_id = r.id\n                WHERE r.referred_by IS NOT NULL\n                  AND t.type = 'deposit'\n                  AND t.status = 'Success'\n                GROUP BY r.referred_by\n            ) spent ON spent.referrer_id = u.id\n            WHERE COALESCE(refs.referrals_count, 0) > 0\n            ORDER BY referrals_count DESC, total_spent DESC\n            LIMIT 10\n        ")
        top_referrers_raw = cursor.fetchall()
        top_referrers = []
        for idx, row in enumerate(top_referrers_raw, 1):
            username = row['username'] or f"id{row['id']}"
            rate = row['partner_rate'] or 20
            total_spent = float(row['total_spent'] or 0)
            earned = total_spent * (rate / 100)
            top_referrers.append({'id': idx, 'name': f'@{username}' if not username.startswith('@') else username, 'count': row['referrals_count'] or 0, 'earned': earned})
        avg_daily = sum(revenue_data) / len(revenue_data) if revenue_data else 0
        best_day_value = max(revenue_data) if revenue_data else 0
        best_day_idx = revenue_data.index(best_day_value) if revenue_data else 0
        best_day_date = (datetime.utcnow() - timedelta(days=period_days - 1 - best_day_idx)).strftime('%d %B') if revenue_data else ''
        return jsonify({'totalUsers': total_users, 'activeSubscriptions': active_subscriptions, 'paymentsToday': payments_today, 'clientsBalance': clients_balance, 'revenueData': revenue_data, 'revenueLabels': revenue_labels, 'userDistData': user_dist_data, 'paymentMethodsData': payment_methods_data, 'totalSubscriptions': total_subscriptions, 'paidSubscriptions': paid_subscriptions, 'expiredSubscriptions': expired_subscriptions, 'trialActiveSubscriptions': trial_active_subscriptions, 'newSubscriptionsToday': new_subscriptions_today, 'boughtThisWeek': bought_this_week, 'boughtThisMonth': bought_this_month, 'avgSubscriptionsPerUser': avg_subscriptions_per_user, 'usersWithSubscriptions': users_with_keys, 'subscriptionPlanDist': plan_distribution.get('items', []), 'subscriptionPlanTotalPurchases': plan_distribution.get('totalPurchases', 0), 'subscriptionPlanTotalUsers': plan_distribution.get('totalUsers', 0), 'conversionRate': conversion_rate, 'revenuePeriodDays': period_days, 'totalInvited': total_invited, 'partners': partners, 'totalPaid': total_paid, 'topReferrers': top_referrers, 'avgDaily': avg_daily, 'bestDayValue': best_day_value, 'bestDayDate': best_day_date})
    finally:
        conn.close()

@app.route('/api/panel/promocodes/stats', methods=['GET'])

@require_auth

def get_promocodes_stats():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT \n                COUNT(*) AS total,\n                SUM(uses_count) AS total_uses,\n                COUNT(CASE WHEN is_active = 1 THEN 1 END) AS active_count\n            FROM promocodes\n        ')
        row = cursor.fetchone()
        return jsonify({'total': row['total'] or 0, 'totalUses': row['total_uses'] or 0, 'activeCount': row['active_count'] or 0})
    finally:
        conn.close()

@app.route('/api/tariffs', methods=['GET'])

def get_public_tariffs():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT * FROM tariff_plans\n            WHERE is_active = 1\n            ORDER BY plan_type, sort_order\n        ')
        rows = cursor.fetchall()
        plans = []
        for row in rows:
            plans.append({'id': row['id'], 'plan_type': row['plan_type'], 'name': row['name'], 'price': float(row['price']), 'duration_days': row['duration_days'], 'is_active': bool(row['is_active']), 'sort_order': row['sort_order']})
        return jsonify(plans)
    finally:
        conn.close()

@app.route('/api/panel/tariffs', methods=['GET'])

@require_auth

def get_tariffs():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT * FROM tariff_plans\n            WHERE is_active = 1\n            ORDER BY plan_type, sort_order\n        ')
        rows = cursor.fetchall()
        plans = []
        for row in rows:
            plans.append({'id': row['id'], 'plan_type': row['plan_type'], 'name': row['name'], 'price': float(row['price']), 'duration_days': row['duration_days'], 'is_active': bool(row['is_active']), 'sort_order': row['sort_order']})
        return jsonify(plans)
    finally:
        conn.close()

@app.route('/api/panel/tariffs', methods=['POST'])

@require_auth

def create_tariff():
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            INSERT INTO tariff_plans (plan_type, name, price, duration_days, is_active, sort_order)\n            VALUES (?, ?, ?, ?, ?, ?)\n        ', (data.get('plan_type'), data.get('name'), data.get('price'), data.get('duration_days'), 1 if data.get('is_active', True) else 0, data.get('sort_order', 0)))
        conn.commit()
        plan_id = cursor.lastrowid
        cursor.execute('SELECT * FROM tariff_plans WHERE id = ?', (plan_id,))
        return jsonify({'success': True, 'plan': dict(cursor.fetchone())})
    finally:
        conn.close()

@app.route('/api/panel/tariffs/<int:plan_id>', methods=['PUT'])

@require_auth

def update_tariff(plan_id: int):
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        fields = []
        values = []
        for key in ['plan_type', 'name', 'price', 'duration_days', 'is_active', 'sort_order']:
            if key in data:
                if key == 'is_active':
                    values.append(1 if data[key] else 0)
                else:
                    values.append(data[key])
                fields.append(f'{key} = ?')
        if not fields:
            return (jsonify({'success': False, 'error': 'Nothing to update'}), 400)
        values.append(plan_id)
        cursor.execute(f"UPDATE tariff_plans SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", tuple(values))
        conn.commit()
        cursor.execute('SELECT * FROM tariff_plans WHERE id = ?', (plan_id,))
        row = cursor.fetchone()
        if not row:
            return (jsonify({'success': False, 'error': 'Plan not found'}), 404)
        return jsonify({'success': True, 'plan': dict(row)})
    finally:
        conn.close()

@app.route('/api/panel/tariffs/<int:plan_id>', methods=['DELETE'])

@require_auth

def delete_tariff(plan_id: int):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('UPDATE tariff_plans SET is_active = 0 WHERE id = ?', (plan_id,))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/panel/auto-discounts', methods=['GET'])

@require_auth

def get_auto_discounts():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM auto_discounts ORDER BY created_at DESC')
        rows = cursor.fetchall()
        discounts = []
        for row in rows:
            discounts.append({'id': row['id'], 'name': row['name'], 'condition_type': row['condition_type'], 'condition_value': row['condition_value'], 'discount_type': row['discount_type'], 'discount_value': float(row['discount_value']), 'is_active': bool(row['is_active'])})
        return jsonify(discounts)
    finally:
        conn.close()

@app.route('/api/panel/auto-discounts', methods=['POST'])

@require_auth

def create_auto_discount():
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            INSERT INTO auto_discounts (name, condition_type, condition_value, discount_type, discount_value, is_active)\n            VALUES (?, ?, ?, ?, ?, ?)\n        ', (data.get('name'), data.get('condition_type'), data.get('condition_value'), data.get('discount_type'), data.get('discount_value'), 1 if data.get('is_active', True) else 0))
        conn.commit()
        discount_id = cursor.lastrowid
        cursor.execute('SELECT * FROM auto_discounts WHERE id = ?', (discount_id,))
        return jsonify({'success': True, 'discount': dict(cursor.fetchone())})
    finally:
        conn.close()

@app.route('/api/panel/auto-discounts/<int:discount_id>', methods=['PUT'])

@require_auth

def update_auto_discount(discount_id: int):
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        fields = []
        values = []
        for key in ['name', 'condition_type', 'condition_value', 'discount_type', 'discount_value', 'is_active']:
            if key in data:
                if key == 'is_active':
                    values.append(1 if data[key] else 0)
                else:
                    values.append(data[key])
                fields.append(f'{key} = ?')
        if not fields:
            return (jsonify({'success': False, 'error': 'Nothing to update'}), 400)
        values.append(discount_id)
        cursor.execute(f"UPDATE auto_discounts SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", tuple(values))
        conn.commit()
        cursor.execute('SELECT * FROM auto_discounts WHERE id = ?', (discount_id,))
        row = cursor.fetchone()
        if not row:
            return (jsonify({'success': False, 'error': 'Discount not found'}), 404)
        return jsonify({'success': True, 'discount': dict(row)})
    finally:
        conn.close()

@app.route('/api/panel/auto-discounts/<int:discount_id>', methods=['DELETE'])

@require_auth

def delete_auto_discount(discount_id: int):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM auto_discounts WHERE id = ?', (discount_id,))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/panel/public-pages', methods=['GET'])

@require_auth

def get_public_pages():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM public_pages')
        rows = cursor.fetchall()
        pages = {}
        for row in rows:
            pages[row['page_type']] = {'id': row['id'], 'content': row['content'], 'updated_at': row['updated_at']}
        return jsonify(pages)
    finally:
        conn.close()

@app.route('/api/panel/public-pages/<page_type>', methods=['PUT'])

@require_auth

def update_public_page(page_type: str):
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT id FROM public_pages WHERE page_type = ?', (page_type,))
        row = cursor.fetchone()
        if row:
            cursor.execute('\n                UPDATE public_pages SET content = ?, updated_at = CURRENT_TIMESTAMP\n                WHERE page_type = ?\n            ', (data.get('content', ''), page_type))
        else:
            cursor.execute('\n                INSERT INTO public_pages (page_type, content)\n                VALUES (?, ?)\n            ', (page_type, data.get('content', '')))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/public-pages', methods=['GET'])

def get_all_public_pages():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT page_type, content, updated_at FROM public_pages')
        rows = cursor.fetchall()
        pages = {}
        for row in rows:
            pages[row['page_type']] = {'content': row['content'], 'updated_at': row['updated_at']}
        return jsonify(pages)
    finally:
        conn.close()

@app.route('/api/public-pages/<page_type>', methods=['GET'])

def get_public_page(page_type: str):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT content FROM public_pages WHERE page_type = ?', (page_type,))
        row = cursor.fetchone()
        if row:
            return jsonify({'content': row['content']})
        return jsonify({'content': ''})
    finally:
        conn.close()

@app.route('/api/panel/settings', methods=['GET'])

@require_auth

def get_settings():
    env_settings = {'TELEGRAM_BOT_TOKEN': os.getenv('TELEGRAM_BOT_TOKEN', ''), 'TELEGRAM_ADMIN_IDS': os.getenv('TELEGRAM_ADMIN_IDS', os.getenv('TELEGRAM_ADMIN_ID', '')), 'REMWAVE_PANEL_URL': os.getenv('REMWAVE_PANEL_URL', os.getenv('REMWAVE_API_URL', '')), 'REMWAVE_API_KEY': os.getenv('REMWAVE_API_KEY', ''), 'PLATEGA_MERCHANT_ID': os.getenv('PLATEGA_MERCHANT_ID', ''), 'PLATEGA_SECRET_KEY': os.getenv('PLATEGA_SECRET_KEY', ''), 'TRIAL_HOURS': os.getenv('TRIAL_HOURS', '24'), 'PANEL_PASSWORD_SET': '1'}
    return jsonify(env_settings)

@app.route('/api/panel/settings', methods=['PUT'])

@require_auth

def update_settings():
    data = request.json
    if not isinstance(data, dict):
        return (jsonify({'error': 'Invalid payload'}), 400)
    try:
        env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env')
        updates: dict[str, str] = {}
        for key, value in data.items():
            if key in ENV_KEYS_MANAGED:
                normalized = str(value)
                if key == 'TELEGRAM_ADMIN_IDS':
                    parts = [p.strip() for p in normalized.replace(';', ',').split(',') if p.strip()]
                    normalized = ','.join(parts)
                updates[key] = normalized
                os.environ[key] = normalized
        if 'TELEGRAM_ADMIN_IDS' in updates:
            os.environ['TELEGRAM_ADMIN_ID'] = updates['TELEGRAM_ADMIN_IDS'].split(',')[0].strip() if updates['TELEGRAM_ADMIN_IDS'].strip() else ''
            updates['TELEGRAM_ADMIN_ID'] = os.environ['TELEGRAM_ADMIN_ID']
        if updates:
            _save_env_map(env_path, updates)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f'Error updating settings: {e}')
        return (jsonify({'error': str(e)}), 500)

@app.route('/api/panel/default-squads', methods=['GET'])

@require_auth

def get_default_squads():
    vpn_squads = database.get_default_squads('vpn')
    return jsonify({'vpn_squads': vpn_squads})

@app.route('/api/panel/default-squads', methods=['PUT'])

@require_auth

def set_default_squads():
    data = request.json
    vpn_squads = data.get('vpn_squads', [])
    if not isinstance(vpn_squads, list):
        return (jsonify({'error': 'squads должен быть массивом UUID'}), 400)
    success_vpn = database.set_default_squads(vpn_squads, 'vpn')
    if success_vpn:
        return jsonify({'success': True, 'vpn_squads': vpn_squads})
    return (jsonify({'error': 'Ошибка сохранения настроек'}), 500)

@app.route('/api/panel/payment-fees', methods=['GET'])

@require_auth

def get_payment_fees():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM payment_fees')
        rows = cursor.fetchall()
        fees = {}
        for row in rows:
            fees[row['payment_method']] = {'fee_percent': float(row['fee_percent']), 'fee_fixed': float(row['fee_fixed'])}
        return jsonify(fees)
    finally:
        conn.close()

@app.route('/api/panel/payment-fees', methods=['PUT'])

@require_auth

def update_payment_fees():
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        for method, fees in data.items():
            cursor.execute('\n                INSERT OR REPLACE INTO payment_fees (payment_method, fee_percent, fee_fixed, updated_at)\n                VALUES (?, ?, ?, CURRENT_TIMESTAMP)\n            ', (method, fees.get('fee_percent', 0), fees.get('fee_fixed', 0)))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/panel/payment-settings', methods=['GET'])

@require_auth

def get_payment_settings():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM payment_provider_settings')
        rows = cursor.fetchall()
        settings = {}
        for row in rows:
            provider = row['provider']
            if provider not in settings:
                settings[provider] = {}
            settings[provider][row['setting_key']] = row['setting_value']
        providers = ['platega']
        for p in providers:
            if p not in settings:
                settings[p] = {'enabled': '0'}
        return jsonify(settings)
    finally:
        conn.close()

@app.route('/api/panel/payment-settings/<provider>', methods=['PUT'])

@require_auth

def update_payment_settings(provider: str):
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        for key, value in data.items():
            cursor.execute('\n                INSERT OR REPLACE INTO payment_provider_settings (provider, setting_key, setting_value, updated_at)\n                VALUES (?, ?, ?, CURRENT_TIMESTAMP)\n            ', (provider, key, str(value)))
        conn.commit()
        if provider == 'platega':
            if 'merchant_id' in data:
                os.environ['PLATEGA_MERCHANT_ID'] = str(data['merchant_id'])
            if 'secret_key' in data:
                os.environ['PLATEGA_SECRET_KEY'] = str(data['secret_key'])
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f'Error updating payment settings for {provider}: {e}')
        return (jsonify({'error': str(e)}), 500)
    finally:
        conn.close()

@app.route('/api/panel/backups/status', methods=['GET'])

@require_auth

def get_backup_status():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM backup_settings ORDER BY id DESC LIMIT 1')
        row = cursor.fetchone()
        if row:
            return jsonify({'enabled': bool(row['enabled']), 'interval_hours': row['interval_hours'], 'last_backup': row['last_backup']})
        return jsonify({'enabled': False, 'interval_hours': 12, 'last_backup': None})
    finally:
        conn.close()

@app.route('/api/panel/backups/settings', methods=['PUT'])

@require_auth

def update_backup_settings():
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT id FROM backup_settings ORDER BY id DESC LIMIT 1')
        row = cursor.fetchone()
        if row:
            cursor.execute('\n                UPDATE backup_settings SET enabled = ?, interval_hours = ?, updated_at = CURRENT_TIMESTAMP\n                WHERE id = ?\n            ', (1 if data.get('enabled') else 0, data.get('interval_hours', 12), row['id']))
        else:
            cursor.execute('\n                INSERT INTO backup_settings (enabled, interval_hours)\n                VALUES (?, ?)\n            ', (1 if data.get('enabled') else 0, data.get('interval_hours', 12)))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/panel/backups/create', methods=['POST'])

@require_auth

def create_backup():
    import os
    import shutil
    import tempfile
    from datetime import datetime
    try:
        db_path = os.getenv('DB_PATH', 'data.db')
        if not os.path.isabs(db_path):
            db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), db_path)
        if not os.path.exists(db_path):
            return (jsonify({'error': 'Database file not found'}), 404)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_name = f'blinvpn_backup_{timestamp}.db'
        with tempfile.TemporaryDirectory() as temp_dir:
            backup_path = os.path.join(temp_dir, backup_name)
            shutil.copy2(db_path, backup_path)
            zip_path = os.path.join(temp_dir, f'{backup_name}.zip')
            shutil.make_archive(backup_path, 'zip', temp_dir, backup_name)
            admin_ids = _parse_admin_ids()
            bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
            if admin_ids and bot_token:
                with open(f'{backup_path}.zip', 'rb') as f:
                    file_bytes = f.read()
                sent_any = False
                for admin_id in admin_ids:
                    result = _telegram_api(bot_token, 'sendDocument', {'chat_id': admin_id, 'caption': f"🗄️ Резервная копия БД\n📅 {datetime.now().strftime('%d.%m.%Y %H:%M')}"}, files={'document': (f'{backup_name}.zip', file_bytes, 'application/zip')})
                    sent_any = bool(result) or sent_any
                if not sent_any:
                    return (jsonify({'error': 'Failed to send backup to admins'}), 500)
        conn = database.get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('UPDATE backup_settings SET last_backup = CURRENT_TIMESTAMP')
            conn.commit()
        finally:
            conn.close()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f'Backup creation error: {e}')
        return (jsonify({'error': str(e)}), 500)

@app.route('/api/panel/remnawave/squads', methods=['GET'])

@require_auth

def get_remnawave_squads():
    try:
        import asyncio
        from backend.api.remnawave import get_remnawave_api, RemnaWaveAPI
        async def fetch_squads():
            api = get_remnawave_api()
            async with api as connected_api:
                internal_squads = await connected_api.get_internal_squads()
                return [{'uuid': s.uuid, 'name': s.name, 'members_count': s.members_count} for s in internal_squads]
        squads = asyncio.run(fetch_squads())
        seen_uuids = set()
        unique_squads = []
        for sq in squads:
            if sq['uuid'] not in seen_uuids:
                seen_uuids.add(sq['uuid'])
                unique_squads.append(sq)
        return jsonify(unique_squads)
    except Exception as e:
        logger.error(f'Error fetching Remnawave squads: {e}')
        return (jsonify({'error': str(e)}), 500)

@app.route('/api/panel/remnawave/sync', methods=['POST'])

@require_auth

def sync_remnawave_keys():
    try:
        result = core.sync_keys_with_remnawave()
        return jsonify(result)
    except Exception as e:
        logger.error(f'Error syncing with Remnawave: {e}')
        return (jsonify({'error': str(e)}), 500)

@app.route('/api/panel/users/mass-action', methods=['POST'])

@require_auth

def mass_user_action():
    data = request.get_json()
    action_type = data.get('action')
    value = data.get('value', '')
    notify = data.get('notify', False)
    user_ids = data.get('user_ids', [])
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        if user_ids:
            placeholders = ','.join('?' * len(user_ids))
            cursor.execute(f'SELECT id, telegram_id, balance FROM users WHERE id IN ({placeholders})', user_ids)
        else:
            cursor.execute('SELECT id, telegram_id, balance FROM users')
        users = cursor.fetchall()
        affected = 0
        notifications = []
        for user in users:
            user_id = user['id']
            telegram_id = user['telegram_id']
            if action_type == 'MASS_ADD_BALANCE':
                amount = float(value)
                cursor.execute('UPDATE users SET balance = balance + ? WHERE id = ?', (amount, user_id))
                cursor.execute("\n                    INSERT INTO transactions (user_id, amount, type, status, description)\n                    VALUES (?, ?, 'deposit', 'Success', 'Начисление от администрации')\n                ", (user_id, amount))
                if notify:
                    notifications.append((telegram_id, f'💰 Вам начислено {amount} ₽ на баланс!'))
                affected += 1
            elif action_type == 'MASS_ADD_DAYS':
                days = int(value)
                cursor.execute("\n                    UPDATE vpn_keys SET expiry_date = datetime(\n                        CASE WHEN expiry_date > datetime('now') THEN expiry_date ELSE datetime('now') END,\n                        '+' || ? || ' days'\n                    ) WHERE user_id = ?\n                ", (days, user_id))
                if notify:
                    notifications.append((telegram_id, f'⏰ Ваша подписка продлена на {days} дней!'))
                affected += 1
            elif action_type == 'MASS_BAN':
                cursor.execute('UPDATE users SET is_banned = 1 WHERE id = ?', (user_id,))
                if notify:
                    notifications.append((telegram_id, f"⛔ Ваш аккаунт заблокирован. Причина: {value or 'Не указана'}"))
                affected += 1
            elif action_type == 'MASS_UNBAN':
                cursor.execute('UPDATE users SET is_banned = 0 WHERE id = ?', (user_id,))
                if notify:
                    notifications.append((telegram_id, '✅ Ваш аккаунт разблокирован!'))
                affected += 1
            elif action_type == 'MASS_RESET_TRIAL':
                cursor.execute('UPDATE users SET trial_used = 0 WHERE id = ?', (user_id,))
                if notify:
                    notifications.append((telegram_id, '🎁 Ваш пробный период сброшен! Вы можете снова воспользоваться триалом.'))
                affected += 1
            elif action_type == 'MASS_DELETE_KEYS':
                cursor.execute('DELETE FROM vpn_keys WHERE user_id = ?', (user_id,))
                if notify:
                    notifications.append((telegram_id, '🔑 Ваши VPN ключи были удалены.'))
                affected += 1
            elif action_type == 'MASS_SET_PARTNER':
                rate = int(value) if value else 20
                cursor.execute('UPDATE users SET is_partner = 1, partner_rate = ? WHERE id = ?', (rate, user_id))
                if notify:
                    notifications.append((telegram_id, f'🤝 Вы стали партнером! Ваша комиссия: {rate}%'))
                affected += 1
            elif action_type == 'MASS_REMOVE_PARTNER':
                cursor.execute('UPDATE users SET is_partner = 0, partner_rate = 0 WHERE id = ?', (user_id,))
                if notify:
                    notifications.append((telegram_id, '👤 Ваш партнерский статус отменен.'))
                affected += 1
        conn.commit()
        if notifications:
            from threading import Thread
            def send_notifications():
                import asyncio
                from aiogram import Bot
                bot = Bot(token=os.getenv('TELEGRAM_BOT_TOKEN', ''))
                async def send_all():
                    for tg_id, msg in notifications:
                        try:
                            await bot.send_message(tg_id, msg)
                        except Exception as e:
                            logger.warning(f'Failed to send notification to {tg_id}: {e}')
                    await bot.session.close()
                asyncio.run(send_all())
            Thread(target=send_notifications, daemon=True).start()
        return jsonify({'success': True, 'affected': affected})
    except Exception as e:
        conn.rollback()
        logger.error(f'Mass action error: {e}')
        return (jsonify({'error': str(e)}), 500)
    finally:
        conn.close()

@app.route('/api/panel/users/<int:user_id>/action', methods=['POST'])

@require_auth

def single_user_action(user_id):
    data = request.get_json()
    action_type = data.get('action')
    value = data.get('value', '')
    notify = data.get('notify', False)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT telegram_id, balance FROM users WHERE id = ?', (user_id,))
        user = cursor.fetchone()
        if not user:
            return (jsonify({'error': 'User not found'}), 404)
        telegram_id = user['telegram_id']
        notification_msg = None
        if action_type == 'ADD_BALANCE':
            amount = float(value)
            cursor.execute('UPDATE users SET balance = balance + ? WHERE id = ?', (amount, user_id))
            cursor.execute("\n                INSERT INTO transactions (user_id, amount, type, status, description)\n                VALUES (?, ?, 'deposit', 'Success', 'Начисление от администрации')\n            ", (user_id, amount))
            notification_msg = f'💰 Вам начислено {amount} ₽ на баланс!'
        elif action_type == 'SUB_BALANCE':
            amount = float(value)
            cursor.execute('UPDATE users SET balance = balance - ? WHERE id = ?', (amount, user_id))
            cursor.execute("\n                INSERT INTO transactions (user_id, amount, type, status, description)\n                VALUES (?, ?, 'withdrawal', 'Success', 'Списание администрацией')\n            ", (user_id, -amount))
            notification_msg = f'💸 С вашего баланса списано {amount} ₽'
        elif action_type == 'EXTEND_SUB':
            days = int(value)
            cursor.execute("\n                UPDATE vpn_keys SET expiry_date = datetime(\n                    CASE WHEN expiry_date > datetime('now') THEN expiry_date ELSE datetime('now') END,\n                    '+' || ? || ' days'\n                ) WHERE user_id = ?\n            ", (days, user_id))
            notification_msg = f'⏰ Ваша подписка продлена на {days} дней!'
        elif action_type == 'REDUCE_SUB':
            days = int(value)
            cursor.execute("\n                UPDATE vpn_keys SET expiry_date = datetime(expiry_date, '-' || ? || ' days')\n                WHERE user_id = ?\n            ", (days, user_id))
            notification_msg = f'⏰ Срок вашей подписки уменьшен на {days} дней.'
        elif action_type == 'SET_TRAFFIC':
            limit_gb = int(value)
            cursor.execute('UPDATE vpn_keys SET traffic_limit = ? WHERE user_id = ?', (limit_gb * 1024 * 1024 * 1024, user_id))
            notification_msg = f'📊 Ваш лимит трафика установлен: {limit_gb} ГБ'
        elif action_type == 'SET_DEVICES':
            limit = int(value)
            cursor.execute('UPDATE vpn_keys SET devices_limit = ? WHERE user_id = ?', (limit, user_id))
            notification_msg = f'📱 Ваш лимит устройств: {limit}'
        elif action_type == 'BAN':
            cursor.execute('UPDATE users SET is_banned = 1 WHERE id = ?', (user_id,))
            notification_msg = f"⛔ Ваш аккаунт заблокирован. Причина: {value or 'Не указана'}"
        elif action_type == 'UNBAN':
            cursor.execute('UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?', (user_id,))
            cursor.execute('DELETE FROM blacklist WHERE telegram_id = ?', (telegram_id,))
            notification_msg = '✅ Ваш аккаунт разблокирован!'
        elif action_type == 'NOTIFY':
            notification_msg = value
        conn.commit()
        if notify and notification_msg:
            from threading import Thread
            def send_notification():
                import asyncio
                from aiogram import Bot
                bot = Bot(token=os.getenv('TELEGRAM_BOT_TOKEN', ''))
                async def send():
                    try:
                        await bot.send_message(telegram_id, notification_msg)
                    except Exception as e:
                        logger.warning(f'Failed to send notification: {e}')
                    await bot.session.close()
                asyncio.run(send())
            Thread(target=send_notification, daemon=True).start()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        logger.error(f'User action error: {e}')
        return (jsonify({'error': str(e)}), 500)
    finally:
        conn.close()

@app.route('/api/panel/auth/login', methods=['POST'])

def panel_login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return (jsonify({'error': 'Username and password required'}), 400)
    admin = database.verify_panel_admin(username, password)
    if not admin:
        return (jsonify({'error': 'Invalid credentials'}), 401)
    admin_ids = _parse_admin_ids()
    bot_token = os.getenv('TELEGRAM_BOT_TOKEN', '')
    if not admin_ids or not bot_token:
        return (jsonify({'error': '2FA not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_IDS'}), 500)
    code = ''.join((secrets.choice('0123456789') for _ in range(6)))
    code_hash = hashlib.sha256(code.encode()).hexdigest()
    ip = _get_client_ip()
    user_agent = request.headers.get('User-Agent', '')[:500]
    expires_at = (datetime.utcnow() + timedelta(minutes=5)).isoformat()
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM panel_login_otp WHERE admin_id = ? AND used_at IS NULL', (admin['id'],))
        cursor.execute('\n            INSERT INTO panel_login_otp (admin_id, code_hash, ip_address, user_agent, expires_at)\n            VALUES (?, ?, ?, ?, ?)\n        ', (admin['id'], code_hash, ip, user_agent, expires_at))
        otp_id = cursor.lastrowid
        conn.commit()
    finally:
        conn.close()
    message = f"🔐 <b>Подтверждение входа в панель</b>\n\nКод: <code>{code}</code>\nIP: <code>{ip or 'unknown'}</code>\nUser-Agent: <code>{user_agent or 'unknown'}</code>\nВремя: {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}\nСрок действия: 5 минут"
    sent_any = False
    for admin_id in admin_ids:
        sent_any = bool(_telegram_api(bot_token, 'sendMessage', {'chat_id': admin_id, 'text': message, 'parse_mode': 'HTML'})) or sent_any
    if not sent_any:
        return (jsonify({'error': 'Failed to deliver 2FA code to admins'}), 500)
    return jsonify({'success': True, 'requires_otp': True, 'otp_id': otp_id})

@app.route('/api/panel/auth/verify-otp', methods=['POST'])

def panel_verify_otp():
    data = request.json or {}
    otp_id = data.get('otp_id')
    code = str(data.get('code', '')).strip()
    if not otp_id or not code:
        return (jsonify({'error': 'otp_id and code required'}), 400)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT id, admin_id, code_hash, expires_at, used_at\n            FROM panel_login_otp\n            WHERE id = ?\n        ', (otp_id,))
        row = cursor.fetchone()
        if not row:
            return (jsonify({'error': 'OTP request not found'}), 404)
        if row['used_at']:
            return (jsonify({'error': 'OTP already used'}), 400)
        if str(row['expires_at']) <= datetime.utcnow().isoformat():
            return (jsonify({'error': 'OTP expired'}), 400)
        if hashlib.sha256(code.encode()).hexdigest() != row['code_hash']:
            return (jsonify({'error': 'Invalid code'}), 401)
        cursor.execute('UPDATE panel_login_otp SET used_at = CURRENT_TIMESTAMP WHERE id = ?', (row['id'],))
        conn.commit()
    finally:
        conn.close()
    session_token = database.create_panel_session(int(row['admin_id']))
    if not session_token:
        return (jsonify({'error': 'Failed to create session'}), 500)
    return jsonify({'success': True, 'session_token': session_token})

@app.route('/api/panel/auth/logout', methods=['POST'])

def panel_logout():
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header[7:]
        database.delete_panel_session(token)
    return jsonify({'success': True})

@app.route('/api/panel/auth/check', methods=['GET'])

def panel_auth_check():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return (jsonify({'authenticated': False}), 401)
    token = auth_header[7:]
    if token == PANEL_SECRET:
        return jsonify({'authenticated': True, 'method': 'legacy'})
    session = database.verify_panel_session(token)
    if session:
        return jsonify({'authenticated': True, 'method': 'session', 'username': session['username']})
    return (jsonify({'authenticated': False}), 401)

@app.route('/api/panel/auth/init', methods=['GET'])

def panel_auth_init():
    result = database.get_or_create_default_admin()
    if result.get('password'):
        return jsonify({'initialized': True, 'new_admin': True, 'username': result['username'], 'password': result['password'], 'message': 'Сохраните эти данные! Пароль показывается только один раз.'})
    elif result.get('exists'):
        return jsonify({'initialized': True, 'new_admin': False, 'username': result['username']})
    else:
        return (jsonify({'initialized': False, 'error': 'Failed to initialize admin'}), 500)

@app.route('/api/panel/auth/change-password', methods=['POST'])

@require_auth

def panel_change_password():
    auth_header = request.headers.get('Authorization')
    token = auth_header[7:] if auth_header and auth_header.startswith('Bearer ') else None
    session = database.verify_panel_session(token) if token else None
    if not session:
        return (jsonify({'error': 'Session required for password change'}), 403)
    data = request.json
    new_password = data.get('new_password')
    if not new_password or len(new_password) < 8:
        return (jsonify({'error': 'Password must be at least 8 characters'}), 400)
    if database.update_admin_password(session['admin_id'], new_password):
        return jsonify({'success': True})
    return (jsonify({'error': 'Failed to update password'}), 500)

@app.route('/api/panel/squads', methods=['GET'])

@require_auth

def get_squads():
    squads = database.get_all_squad_configs()
    mapping = database.get_subscription_squad_mapping()
    return jsonify({'squads': squads, 'mapping': mapping})

@app.route('/api/panel/squads/sync', methods=['POST'])

@require_auth

def sync_squads():
    try:
        import asyncio
        async def do_sync():
            api = remnawave.get_remnawave_api()
            async with api as rw_api:
                rw_squads = await rw_api.get_internal_squads()
                synced = []
                for squad in rw_squads:
                    name_lower = squad.name.lower()
                    if 'wifi' in name_lower or 'vpn' in name_lower:
                        squad_type = 'vpn'
                    elif 'lte' in name_lower or 'whitelist' in name_lower:
                        squad_type = 'vpn'
                    elif 'trial' in name_lower or 'test' in name_lower:
                        squad_type = 'trial'
                    else:
                        squad_type = 'vpn'
                    database.upsert_squad_config(squad_uuid=squad.uuid, squad_name=squad.name, squad_type=squad_type, max_users=0, priority=squad.view_position)
                    synced.append({'uuid': squad.uuid, 'name': squad.name, 'type': squad_type})
                database.sync_squad_user_counts()
                return synced
        synced = asyncio.run(do_sync())
        return jsonify({'success': True, 'synced': synced, 'count': len(synced)})
    except Exception as e:
        logger.error(f'Squad sync error: {e}')
        return (jsonify({'error': str(e)}), 500)

@app.route('/api/panel/squads/<squad_uuid>', methods=['PUT'])

@require_auth

def update_squad(squad_uuid: str):
    data = request.json
    squad_name = data.get('squad_name')
    squad_type = data.get('squad_type')
    max_users = data.get('max_users', 0)
    priority = data.get('priority', 0)
    is_active = data.get('is_active', True)
    if not squad_name or not squad_type:
        return (jsonify({'error': 'squad_name and squad_type required'}), 400)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            UPDATE squad_configs \n            SET squad_name = ?, squad_type = ?, max_users = ?, \n                priority = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP\n            WHERE squad_uuid = ?\n        ', (squad_name, squad_type, max_users, priority, 1 if is_active else 0, squad_uuid))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return (jsonify({'error': str(e)}), 500)
    finally:
        conn.close()

@app.route('/api/panel/squads/mapping', methods=['PUT'])

@require_auth

def update_squad_mapping():
    data = request.json
    vpn_squads = data.get('vpn', [])
    trial_squads = data.get('trial', [])
    success = True
    success = success and database.set_subscription_squads('vpn', vpn_squads)
    success = success and database.set_subscription_squads('trial', trial_squads)
    if success:
        return jsonify({'success': True})
    return (jsonify({'error': 'Failed to update mapping'}), 500)

@app.route('/api/panel/squads/counts', methods=['POST'])

@require_auth

def sync_squad_counts():
    database.sync_squad_user_counts()
    return jsonify({'success': True})

@app.route('/api/panel/issue-key', methods=['POST'])

@require_auth

def issue_key_with_type():
    data = request.json
    user_id = data.get('user_id')
    plan_type = data.get('plan_type', 'vpn')
    days = data.get('days', 30)
    traffic_limit_gb = data.get('traffic_limit_gb', 0)
    if not user_id:
        return (jsonify({'error': 'user_id required'}), 400)
    user = database.get_user_by_id(user_id)
    if not user:
        return (jsonify({'error': 'User not found'}), 404)
    try:
        best_squad = database.get_best_squad_for_subscription(plan_type)
        squad_uuids = [best_squad['squad_uuid']] if best_squad else None
        if not squad_uuids:
            squad_uuids = database.get_default_squads(plan_type)
        traffic_limit_bytes = int(traffic_limit_gb * 1024 * 1024 * 1024) if traffic_limit_gb > 0 else 0
        result = core.create_user_and_subscription(telegram_id=user['telegram_id'], username=user.get('username', ''), days=days, traffic_limit=traffic_limit_bytes, plan_type=plan_type, squad_uuids=squad_uuids, force_new=True)
        if result:
            if best_squad:
                database.update_squad_user_count(best_squad['squad_uuid'], 1)
            return jsonify({'success': True, 'subscription': result, 'squad': best_squad['squad_name'] if best_squad else 'default'})
        return (jsonify({'error': 'Failed to create subscription'}), 500)
    except Exception as e:
        logger.error(f'Issue key error: {e}')
        return (jsonify({'error': str(e)}), 500)

def auto_backup():
    import shutil
    import tempfile
    try:
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT enabled FROM backup_settings ORDER BY id DESC LIMIT 1')
        row = cursor.fetchone()
        conn.close()
        if not row or not row['enabled']:
            logger.info('Auto backup skipped - disabled in settings')
            return
        db_path = os.getenv('DB_PATH', 'data.db')
        if not os.path.isabs(db_path):
            db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), db_path)
        if not os.path.exists(db_path):
            logger.error('Database file not found for auto backup')
            return
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_name = f'blinvpn_auto_backup_{timestamp}.db'
        with tempfile.TemporaryDirectory() as temp_dir:
            backup_path = os.path.join(temp_dir, backup_name)
            shutil.copy2(db_path, backup_path)
            shutil.make_archive(backup_path, 'zip', temp_dir, backup_name)
            admin_ids = _parse_admin_ids()
            bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
            if admin_ids and bot_token:
                with open(f'{backup_path}.zip', 'rb') as f:
                    file_bytes = f.read()
                sent_any = False
                for admin_id in admin_ids:
                    result = _telegram_api(bot_token, 'sendDocument', {'chat_id': admin_id, 'caption': f"🗄️ Автоматический бэкап БД\n📅 {datetime.now().strftime('%d.%m.%Y %H:%M')} МСК"}, files={'document': (f'{backup_name}.zip', file_bytes, 'application/zip')})
                    sent_any = bool(result) or sent_any
                if sent_any:
                    logger.info('Auto backup sent successfully')
                else:
                    logger.error('Failed to send auto backup to any admin')
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute('UPDATE backup_settings SET last_backup = CURRENT_TIMESTAMP')
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f'Auto backup error: {e}')

@app.route('/api/panel/export/<data_type>', methods=['GET'])

@require_auth

def export_data(data_type: str):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        if data_type == 'users':
            cursor.execute('SELECT * FROM users ORDER BY id')
        elif data_type == 'keys':
            cursor.execute('SELECT * FROM vpn_keys ORDER BY id')
        elif data_type == 'transactions':
            cursor.execute('SELECT * FROM transactions ORDER BY id DESC LIMIT 10000')
        else:
            return (jsonify({'error': 'Invalid data type'}), 400)
        rows = cursor.fetchall()
        data = [dict(row) for row in rows]
        return jsonify({'data': data})
    finally:
        conn.close()

@app.route('/api/panel/diagnostics', methods=['GET'])

@require_auth

def get_diagnostics():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    issues = []
    try:
        cursor.execute('SELECT COUNT(*) FROM users')
        users_count = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM vpn_keys')
        keys_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM vpn_keys WHERE status = 'Active' AND expiry_date > datetime('now')")
        active_keys = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM vpn_keys WHERE expiry_date < datetime('now')")
        expired_keys = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM users WHERE is_banned = 1')
        banned_users = cursor.fetchone()[0]
        remnawave_status = 'OK'
        try:
            rw_squads = remnawave.get_all_squads()
            if not rw_squads:
                remnawave_status = 'Нет сквадов'
                issues.append('Remnawave: нет доступных сквадов')
        except Exception as e:
            remnawave_status = 'Ошибка'
            issues.append(f'Remnawave: {str(e)[:50]}')
        if expired_keys > 100:
            issues.append(f'Много истёкших ключей: {expired_keys}')
        cursor.execute('SELECT COUNT(*) FROM users WHERE balance < 0')
        negative_balance = cursor.fetchone()[0]
        if negative_balance > 0:
            issues.append(f'Пользователей с отрицательным балансом: {negative_balance}')
        return jsonify({'users_count': users_count, 'keys_count': keys_count, 'active_keys': active_keys, 'expired_keys': expired_keys, 'banned_users': banned_users, 'remnawave_status': remnawave_status, 'issues': issues})
    finally:
        conn.close()

@app.route('/api/panel/tools/cleanup-expired', methods=['POST'])

@require_auth

def cleanup_expired_keys():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("\n            SELECT key_uuid FROM vpn_keys \n            WHERE expiry_date < datetime('now', '-30 days')\n        ")
        keys_to_delete = [row[0] for row in cursor.fetchall()]
        deleted = 0
        for key_uuid in keys_to_delete:
            try:
                remnawave.delete_user(key_uuid)
                deleted += 1
            except:
                pass
        cursor.execute("\n            DELETE FROM vpn_keys \n            WHERE expiry_date < datetime('now', '-30 days')\n        ")
        conn.commit()
        return jsonify({'success': True, 'deleted': deleted})
    finally:
        conn.close()

def start_backup_scheduler():
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        import pytz
        scheduler = BackgroundScheduler()
        moscow_tz = pytz.timezone('Europe/Moscow')
        scheduler.add_job(auto_backup, CronTrigger(hour=2, minute=0, timezone=moscow_tz), id='auto_backup', name='Daily backup at 02:00 MSK', replace_existing=True)
        scheduler.start()
        logger.info('Backup scheduler started - daily at 02:00 MSK')
    except ImportError:
        logger.warning('APScheduler not installed, auto backups disabled. Install with: pip install apscheduler pytz')
    except Exception as e:
        logger.error(f'Failed to start backup scheduler: {e}')
if __name__ == '__main__':
    start_backup_scheduler()
    app.run(host='0.0.0.0', port=int(os.getenv('API_PORT', 8000)))
