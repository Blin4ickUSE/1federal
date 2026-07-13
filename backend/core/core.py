import os
import logging
import asyncio
import requests
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta, date
from backend.database import database
from backend.api import remnawave
from backend.core import abuse_detected
logger = logging.getLogger(__name__)
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_ADMIN_ID = os.getenv('TELEGRAM_ADMIN_ID', '')
TELEGRAM_SUPPORT_GROUP_ID = os.getenv('TELEGRAM_SUPPORT_GROUP_ID', '')

def _get_admin_ids() -> List[int]:
    raw = os.getenv('TELEGRAM_ADMIN_IDS') or os.getenv('TELEGRAM_ADMIN_ID', '')
    result: List[int] = []
    for part in str(raw).replace(';', ',').split(','):
        part = part.strip()
        if not part:
            continue
        try:
            result.append(int(part))
        except ValueError:
            continue
    return list(dict.fromkeys(result))

def send_notification_to_user(telegram_id: int, message: str, reply_markup: dict=None) -> bool:
    if not TELEGRAM_BOT_TOKEN:
        return False
    try:
        url = f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage'
        data = {'chat_id': telegram_id, 'text': message, 'parse_mode': 'HTML'}
        if reply_markup:
            data['reply_markup'] = reply_markup
        response = requests.post(url, json=data, timeout=5)
        return response.status_code == 200
    except Exception as e:
        logger.error(f'Failed to send notification to user {telegram_id}: {e}')
        return False

def send_key_created_notification(telegram_id: int, days: int, traffic_gb: int, devices: int) -> bool:
    if not TELEGRAM_BOT_TOKEN:
        return False
    miniapp_url = os.getenv('MINIAPP_URL', '')
    message = f'🎉 <b>Ваш VPN ключ готов!</b>\n\n📅 Срок действия: {days} дней\n📊 Лимит трафика: {traffic_gb} ГБ\n📱 Устройства: {devices}\n\n🔗 Нажмите, чтобы увидеть инструкцию'
    reply_markup = {'inline_keyboard': [[{'text': '📱 Открыть приложение', 'web_app': {'url': miniapp_url}}]]}
    return send_notification_to_user(telegram_id, message, reply_markup)

def send_notification_to_admin(message: str, reply_markup: dict=None) -> bool:
    admin_ids = _get_admin_ids()
    if not admin_ids or not TELEGRAM_BOT_TOKEN:
        return False
    success = False
    for admin_id in admin_ids:
        success = send_notification_to_user(admin_id, message, reply_markup) or success
    return success

def send_withdrawal_request_to_admin(transaction_id: int, user_id: int, telegram_id: int, username: str, amount: float, method: str, details: str) -> bool:
    if not _get_admin_ids() or not TELEGRAM_BOT_TOKEN:
        return False
    message = f'💸 <b>Запрос на вывод средств</b>\n\n🆔 ID заявки: #{transaction_id}\n👤 Пользователь: @{username}\n🔢 Telegram ID: {telegram_id}\n💵 Сумма: {amount}₽\n💳 Метод: {method}\n📝 Детали: {details}'
    reply_markup = {'inline_keyboard': [[{'text': '✅ Принять', 'callback_data': f'withdraw_approve_{transaction_id}'}, {'text': '❌ Отказать', 'callback_data': f'withdraw_reject_{transaction_id}'}]]}
    return send_notification_to_admin(message, reply_markup)

def send_formatted_notification(telegram_id: int, message: str, parse_mode: str='HTML', reply_markup: dict=None) -> bool:
    if not TELEGRAM_BOT_TOKEN:
        return False
    try:
        url = f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage'
        data = {'chat_id': telegram_id, 'text': message, 'parse_mode': parse_mode}
        if reply_markup:
            data['reply_markup'] = reply_markup
        response = requests.post(url, json=data, timeout=10)
        if response.status_code != 200:
            if 'parse_error' in response.text.lower() or "can't parse" in response.text.lower():
                data['parse_mode'] = None
                response = requests.post(url, json=data, timeout=10)
        return response.status_code == 200
    except Exception as e:
        logger.error(f'Failed to send formatted notification to {telegram_id}: {e}')
        return False

def send_photo_to_user(telegram_id: int, photo_url: str, caption: str=None, parse_mode: str='HTML', reply_markup: dict=None) -> bool:
    if not TELEGRAM_BOT_TOKEN:
        return False
    try:
        url = f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto'
        data = {'chat_id': telegram_id, 'photo': photo_url}
        if caption:
            data['caption'] = caption
            data['parse_mode'] = parse_mode
        if reply_markup:
            data['reply_markup'] = reply_markup
        response = requests.post(url, json=data, timeout=15)
        return response.status_code == 200
    except Exception as e:
        logger.error(f'Failed to send photo to {telegram_id}: {e}')
        return False

def send_notification_to_support_group(message: str) -> bool:
    if not TELEGRAM_SUPPORT_GROUP_ID or not TELEGRAM_BOT_TOKEN:
        return False
    try:
        url = f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage'
        data = {'chat_id': TELEGRAM_SUPPORT_GROUP_ID, 'text': message, 'parse_mode': 'HTML'}
        response = requests.post(url, json=data, timeout=5)
        return response.status_code == 200
    except Exception as e:
        logger.error(f'Failed to send notification to support group: {e}')
        return False

def sanitize_username(username: str, telegram_id: int) -> str:
    import re
    if not username:
        return f'user_{telegram_id}'
    sanitized = re.sub('[^a-zA-Z0-9_-]', '', username)
    if not sanitized:
        return f'user_{telegram_id}'
    if sanitized[0] in '_-':
        sanitized = f'u{sanitized}'
    return sanitized

def _parse_rw_expire_at(rw_obj) -> Optional[datetime]:
    if rw_obj is None:
        return None
    val = None
    if hasattr(rw_obj, 'expire_at'):
        val = rw_obj.expire_at
    elif isinstance(rw_obj, dict):
        val = rw_obj.get('expire_at')
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.replace(tzinfo=None) if val.tzinfo else val
    if isinstance(val, date) and (not isinstance(val, datetime)):
        return datetime.combine(val, datetime.min.time())
    if isinstance(val, str):
        try:
            s = val.replace('Z', '+00:00')
            dt = datetime.fromisoformat(s)
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except Exception:
            return None
    return None

def create_user_and_subscription(telegram_id: int, username: str, days: int, referred_by: int=None, traffic_limit: int=None, squad_uuids: list=None, plan_type: str='vpn', devices_limit: int=2, force_new: bool=False) -> Optional[Dict]:
    try:
        user_id = database.create_user(telegram_id, username, referred_by=referred_by)
        squad_plan_type = 'vpn' if plan_type in ('vpn_regular', 'vpn_family') else plan_type
        if squad_uuids is None:
            best_squad = database.get_best_squad_for_subscription(squad_plan_type)
            if best_squad:
                squad_uuids = [best_squad['squad_uuid']]
                logger.info(f"Auto-selected squad {best_squad['squad_name']} for {squad_plan_type} (users: {best_squad['current_users']})")
            else:
                squad_uuids = database.get_default_squads(squad_plan_type)
        logger.info(f'Creating subscription for {telegram_id}, plan_type={plan_type}, squads={squad_uuids}')
        remnawave_user = None
        existing_users = remnawave.remnawave_api.get_user_by_telegram_id(telegram_id)
        if not force_new and existing_users and (len(existing_users) > 0):
            remnawave_user = existing_users[0]
            cur = _parse_rw_expire_at(remnawave_user)
            base = datetime.now()
            if cur and cur > base:
                base = cur
            expire_at = base + timedelta(days=days)
            if hasattr(remnawave_user, 'uuid'):
                existing_uuid = remnawave_user.uuid
            elif isinstance(remnawave_user, dict):
                existing_uuid = remnawave_user.get('uuid')
            else:
                existing_uuid = None
            if existing_uuid:
                logger.info(f'User already exists in Remnawave, updating subscription: {existing_uuid}')
                updated_user = remnawave.remnawave_api.update_user_sync(uuid=existing_uuid, expire_at=expire_at, traffic_limit_bytes=traffic_limit or 0, hwid_device_limit=devices_limit, active_internal_squads=squad_uuids if squad_uuids else None)
                if updated_user:
                    remnawave_user = updated_user
                else:
                    logger.warning(f'Failed to update existing user {existing_uuid}, will try to create new')
                    remnawave_user = None
        if not remnawave_user:
            import time
            timestamp = int(time.time() * 1000) % 1000000
            base_username = sanitize_username(username, telegram_id)
            unique_username = f'{base_username}_{timestamp}'
            try:
                remnawave_user = remnawave.remnawave_api.create_user_with_params(telegram_id=telegram_id, username=unique_username, days=days, traffic_limit_bytes=traffic_limit or 0, hwid_device_limit=devices_limit, active_internal_squads=squad_uuids if squad_uuids else None)
            except Exception as create_error:
                error_msg = str(create_error).lower()
                if 'already exists' in error_msg or 'a019' in error_msg:
                    import random
                    unique_username = f'{base_username}_{telegram_id}_{random.randint(1000, 9999)}'
                    logger.info(f'Username collision, trying {unique_username}')
                    remnawave_user = remnawave.remnawave_api.create_user_with_params(telegram_id=telegram_id, username=unique_username, days=days, traffic_limit_bytes=traffic_limit or 0, hwid_device_limit=devices_limit, active_internal_squads=squad_uuids if squad_uuids else None)
                else:
                    raise create_error
        if not remnawave_user:
            logger.error(f'Failed to create user in Remnawave: {telegram_id}')
            return None
        if hasattr(remnawave_user, 'uuid'):
            user_uuid = remnawave_user.uuid
        elif isinstance(remnawave_user, dict):
            user_uuid = remnawave_user.get('uuid')
        else:
            logger.error(f'Unknown remnawave_user type: {type(remnawave_user)}')
            return None
        if not user_uuid:
            logger.error(f'Failed to extract UUID from remnawave_user for {telegram_id}. remnawave_user type: {type(remnawave_user)}')
            return None
        if hasattr(remnawave_user, 'subscription_url'):
            subscription_url = remnawave_user.subscription_url
        elif isinstance(remnawave_user, dict):
            subscription_url = remnawave_user.get('subscription_url', '')
        else:
            subscription_url = ''
        subscription = remnawave_user
        if not subscription:
            logger.error(f'Failed to create subscription: {user_uuid}')
            return None
        logger.info(f'Successfully created remnawave user with UUID: {user_uuid} for telegram_id: {telegram_id}')
        if subscription:
            subscription_url = subscription.subscription_url if hasattr(subscription, 'subscription_url') else subscription.get('subscription_url') if isinstance(subscription, dict) else subscription_url
        subscription_data = None
        if subscription:
            if hasattr(subscription, '__dict__'):
                subscription_data = {'uuid': subscription.uuid if hasattr(subscription, 'uuid') else None, 'username': subscription.username if hasattr(subscription, 'username') else None, 'status': subscription.status.value if hasattr(subscription, 'status') and hasattr(subscription.status, 'value') else str(subscription.status) if hasattr(subscription, 'status') else None, 'subscription_url': subscription.subscription_url if hasattr(subscription, 'subscription_url') else None, 'expire_at': subscription.expire_at.isoformat() if hasattr(subscription, 'expire_at') and subscription.expire_at else None, 'traffic_limit_bytes': subscription.traffic_limit_bytes if hasattr(subscription, 'traffic_limit_bytes') else None}
            elif isinstance(subscription, dict):
                subscription_data = subscription
            else:
                subscription_data = str(subscription)
        if not user_id:
            logger.error(f'Invalid user_id returned from create_user for telegram_id: {telegram_id}')
            return None
        conn = database.get_db_connection()
        cursor = conn.cursor()
        db_exp = _parse_rw_expire_at(remnawave_user)
        if not db_exp:
            db_exp = datetime.now() + timedelta(days=days)
        expiry_date = db_exp.isoformat()
        cursor.execute('SELECT id FROM vpn_keys WHERE key_uuid = ?', (user_uuid,))
        existing_key = cursor.fetchone()
        cursor.execute("SELECT id, key_uuid FROM vpn_keys WHERE user_id = ? AND status = 'Active'", (user_id,))
        user_active_keys = cursor.fetchall()
        logger.info(f'Saving key to DB: user_id={user_id}, user_uuid={user_uuid}, existing_key={existing_key is not None}, user_active_keys_count={len(user_active_keys)}')
        assigned_squad_uuid = squad_uuids[0] if squad_uuids else None
        key_id = None
        if existing_key:
            key_id = existing_key['id']
            logger.info(f'Updating existing key in DB: key_id={key_id}, user_uuid={user_uuid}')
            cursor.execute("\n                UPDATE vpn_keys SET status = 'Active', expiry_date = ?, traffic_limit = ?, \n                       key_config = ?, squad_uuid = ?, plan_type = ?, user_id = ?, devices_limit = ?\n                WHERE id = ?\n            ", (expiry_date, traffic_limit, subscription_url, assigned_squad_uuid, plan_type, user_id, devices_limit, key_id))
        else:
            logger.info(f'Creating new key in DB: user_id={user_id}, user_uuid={user_uuid}')
            try:
                cursor.execute("\n                    INSERT INTO vpn_keys (user_id, key_uuid, key_config, status, expiry_date, \n                                         devices_limit, traffic_limit, squad_uuid, plan_type)\n                    VALUES (?, ?, ?, 'Active', ?, ?, ?, ?, ?)\n                ", (user_id, user_uuid, subscription_url, expiry_date, devices_limit, traffic_limit, assigned_squad_uuid, plan_type))
                key_id = cursor.lastrowid
                logger.info(f'Successfully inserted new key: key_id={key_id}')
            except Exception as insert_error:
                logger.error(f'Failed to insert key into DB: {insert_error}')
                if 'UNIQUE constraint' in str(insert_error) or 'unique' in str(insert_error).lower():
                    cursor.execute('SELECT id FROM vpn_keys WHERE key_uuid = ?', (user_uuid,))
                    existing_by_uuid = cursor.fetchone()
                    if existing_by_uuid:
                        key_id = existing_by_uuid['id']
                        logger.info(f'Key with UUID {user_uuid} already exists, updating: key_id={key_id}')
                        cursor.execute("\n                            UPDATE vpn_keys SET status = 'Active', expiry_date = ?, traffic_limit = ?, \n                                   key_config = ?, squad_uuid = ?, plan_type = ?, user_id = ?, devices_limit = ?\n                            WHERE id = ?\n                        ", (expiry_date, traffic_limit, subscription_url, assigned_squad_uuid, plan_type, user_id, devices_limit, key_id))
                    else:
                        raise insert_error
                else:
                    raise insert_error
        conn.commit()
        conn.close()
        if not key_id:
            logger.error(f'Failed to create key_id in DB for user_id={user_id}, user_uuid={user_uuid}')
            return None
        logger.info(f'Successfully saved key to DB: key_id={key_id}, user_id={user_id}, user_uuid={user_uuid}')
        if assigned_squad_uuid:
            database.update_squad_user_count(assigned_squad_uuid, 1)
        return {'user_id': user_id, 'key_id': key_id, 'remnawave_uuid': user_uuid, 'subscription_url': subscription_url, 'subscription': subscription_data, 'squad_uuid': assigned_squad_uuid, 'plan_type': plan_type}
    except Exception as e:
        logger.error(f'Error creating user and subscription: {e}')
        import traceback
        traceback.print_exc()
        return None

def process_payment(user_id: int, amount: float, payment_method: str, payment_provider: str) -> Optional[Dict]:
    try:
        database.update_user_balance(user_id, amount)
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("\n            INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider)\n            VALUES (?, 'deposit', ?, 'Success', ?, ?)\n        ", (user_id, amount, payment_method, payment_provider))
        conn.commit()
        conn.close()
        user = database.get_user_by_id(user_id)
        if user:
            send_notification_to_admin(f"💳 Платеж получен:\nПользователь: @{user.get('username', 'N/A')}\nСумма: {amount}₽\nМетод: {payment_method} ({payment_provider})")
        return {'success': True}
    except Exception as e:
        logger.error(f'Error processing payment: {e}')
        return None

def check_blacklist(telegram_id: int) -> bool:
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT id FROM blacklist WHERE telegram_id = ?', (telegram_id,))
        return cursor.fetchone() is not None
    finally:
        conn.close()

def apply_promocode(user_id: int, code: str) -> Dict[str, Any]:
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT * FROM promocodes\n            WHERE code = ? AND is_active = 1\n            AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)\n        ', (code.upper(),))
        promo = cursor.fetchone()
        if not promo:
            return {'success': False, 'error': 'Промокод не найден или истек'}
        promo_dict = dict(promo)
        if promo_dict['uses_limit'] and promo_dict['uses_count'] >= promo_dict['uses_limit']:
            return {'success': False, 'error': 'Промокод исчерпан'}
        cursor.execute('\n            SELECT id FROM promocode_uses\n            WHERE promocode_id = ? AND user_id = ?\n        ', (promo_dict['id'], user_id))
        if cursor.fetchone():
            return {'success': False, 'error': 'Вы уже использовали этот промокод'}
        promo_type = (promo_dict.get('type') or '').strip().lower()
        promo_value = promo_dict.get('value')
        normalized_value = str(promo_value).strip().replace(',', '.') if promo_value is not None else ''
        mark_promo_used = True
        extra: Dict[str, Any] = {}
        if promo_type == 'balance':
            amount = float(normalized_value or 0)
            database.update_user_balance(user_id, amount)
            result_message = f'Баланс пополнен на {amount}₽'
        elif promo_type == 'discount':
            pct = float(normalized_value or 0)
            pct = max(0.0, min(100.0, pct))
            database.set_user_promo_discount(user_id, pct)
            result_message = f'Скидка {pct:g}% будет применена к следующей покупке подписки с баланса'
        elif promo_type == 'subscription':
            if not normalized_value:
                return {'success': False, 'error': 'Некорректное значение промокода'}
            days = int(round(float(normalized_value)))
            if days <= 0:
                return {'success': False, 'error': 'Некорректное число дней'}
            u = database.get_user_by_id(user_id)
            if not u:
                return {'success': False, 'error': 'Пользователь не найден'}
            database.set_pending_promo_subscription(user_id, promo_dict['id'], days)
            result_message = f'Выберите устройство для активации ({days} дн.)'
            mark_promo_used = False
            extra['open_wizard_subscription'] = True
            extra['pending_subscription_days'] = days
        else:
            return {'success': False, 'error': 'Неизвестный тип промокода'}
        if mark_promo_used:
            cursor.execute('\n                INSERT INTO promocode_uses (promocode_id, user_id)\n                VALUES (?, ?)\n            ', (promo_dict['id'], user_id))
            cursor.execute('\n                UPDATE promocodes\n                SET uses_count = uses_count + 1\n                WHERE id = ?\n            ', (promo_dict['id'],))
        conn.commit()
        out: Dict[str, Any] = {'success': True, 'message': result_message}
        out.update(extra)
        return out
    finally:
        conn.close()

def get_referral_stats(user_id: int) -> Dict[str, Any]:
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        user = database.get_user_by_id(user_id)
        if not user:
            return {}
        cursor.execute('\n            SELECT COUNT(*) as count\n            FROM users\n            WHERE referred_by = ?\n        ', (user_id,))
        result = cursor.fetchone()
        referrals_count = result[0] if result else 0
        partner_balance = user.get('partner_balance', 0) or 0
        total_earned = user.get('total_earned', 0) or 0
        return {'referrals_count': referrals_count, 'partner_balance': partner_balance, 'total_earned': total_earned, 'rate': user.get('partner_rate', 20)}
    finally:
        conn.close()

def sync_keys_with_remnawave() -> Dict:
    try:
        remnawave_uuids = set()
        start = 0
        size = 100
        while True:
            result = remnawave.remnawave_api.get_all_users_sync(start=start, size=size)
            users = result.get('users', [])
            total = result.get('total', 0)
            for user in users:
                if hasattr(user, 'uuid'):
                    remnawave_uuids.add(user.uuid)
                elif isinstance(user, dict):
                    remnawave_uuids.add(user.get('uuid'))
            start += size
            if start >= total:
                break
        logger.info(f'Found {len(remnawave_uuids)} users in Remnawave')
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id, key_uuid, user_id FROM vpn_keys WHERE key_uuid IS NOT NULL')
        db_keys = cursor.fetchall()
        deleted_count = 0
        for key in db_keys:
            key_id = key['id']
            key_uuid = key['key_uuid']
            user_id = key['user_id']
            if key_uuid and key_uuid not in remnawave_uuids:
                logger.info(f'Key {key_uuid} not found in Remnawave, deleting from DB')
                cursor.execute('DELETE FROM vpn_keys WHERE id = ?', (key_id,))
                deleted_count += 1
        conn.commit()
        conn.close()
        logger.info(f'Sync completed: deleted {deleted_count} keys from DB')
        return {'success': True, 'remnawave_users': len(remnawave_uuids), 'deleted_keys': deleted_count}
    except Exception as e:
        logger.error(f'Error syncing with Remnawave: {e}')
        import traceback
        traceback.print_exc()
        return {'success': False, 'error': str(e)}
