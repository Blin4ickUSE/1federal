"""Account linking and subscription merge helpers."""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

from src.database import database
from src.api import remnawave

logger = logging.getLogger(__name__)


def _parse_expiry(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00').replace(' ', 'T'))
        if dt.tzinfo:
            dt = dt.replace(tzinfo=None)
        return dt
    except Exception:
        return None


def remaining_days(expiry) -> int:
    exp = _parse_expiry(expiry)
    if not exp:
        return 0
    delta = exp - datetime.now()
    secs = max(0, int(delta.total_seconds()))
    return max(0, (secs + 86399) // 86400)


def subscription_summary(user_id: int) -> Dict[str, Any]:
    key = database.get_active_vpn_key_for_user(user_id)
    user = database.get_user_by_id(user_id) or {}
    if not key:
        return {
            'user_id': user_id,
            'has_subscription': False,
            'days_left': 0,
            'devices_limit': 0,
            'email': user.get('email'),
            'telegram_id': user.get('telegram_id'),
            'balance': user.get('balance') or 0,
        }
    return {
        'user_id': user_id,
        'has_subscription': True,
        'days_left': remaining_days(key.get('expiry_date')),
        'devices_limit': int(key.get('devices_limit') or 1),
        'vpn_key_id': key.get('id'),
        'email': user.get('email'),
        'telegram_id': user.get('telegram_id'),
        'balance': user.get('balance') or 0,
        'expiry_date': key.get('expiry_date'),
    }


def build_pending_payload(link: Dict[str, Any]) -> Dict[str, Any]:
    a = subscription_summary(int(link['initiator_user_id']))
    b = subscription_summary(int(link['other_user_id']))
    return {
        'id': link['id'],
        'link_type': link['link_type'],
        'status': link['status'],
        'chosen_primary_user_id': link.get('chosen_primary_user_id'),
        'initiator': a,
        'other': b,
        'link_email': link.get('link_email'),
        'link_telegram_id': link.get('link_telegram_id'),
    }


def needs_merge_choice(user_a_id: int, user_b_id: int) -> bool:
    """Ask which subscription is primary when both sides have active access or meaningful state."""
    if user_a_id == user_b_id:
        return False
    a = subscription_summary(user_a_id)
    b = subscription_summary(user_b_id)
    if a['has_subscription'] and b['has_subscription']:
        return True
    # Also ask if both have balances / partner money to avoid silent loss of clarity
    if (a['has_subscription'] or b['has_subscription']) and (a['balance'] > 0 or b['balance'] > 0):
        if a['has_subscription'] != b['has_subscription']:
            return True
    if a['has_subscription'] and b['has_subscription']:
        return True
    # If both have any subscription marker, force choice
    return bool(a['has_subscription'] and b['has_subscription'])


def merge_accounts(primary_user_id: int, secondary_user_id: int) -> Tuple[bool, str]:
    if primary_user_id == secondary_user_id:
        return (False, 'Нельзя объединить аккаунт сам с собой')
    primary = database.get_user_by_id(primary_user_id)
    secondary = database.get_user_by_id(secondary_user_id)
    if not primary or not secondary:
        return (False, 'Пользователь не найден')

    primary_key = database.get_active_vpn_key_for_user(primary_user_id)
    secondary_key = database.get_active_vpn_key_for_user(secondary_user_id)

    days_a = remaining_days(primary_key.get('expiry_date')) if primary_key else 0
    days_b = remaining_days(secondary_key.get('expiry_date')) if secondary_key else 0
    devices_a = int((primary_key or {}).get('devices_limit') or 0)
    devices_b = int((secondary_key or {}).get('devices_limit') or 0)
    total_days = days_a + days_b
    total_devices = max(devices_a + devices_b, 1) if (primary_key or secondary_key) else 0

    # Prefer keeping Remnawave identity of primary key; else secondary
    keeper_key = primary_key or secondary_key
    if keeper_key and total_days > 0:
        new_expiry = datetime.now() + timedelta(days=total_days)
        plan_type = keeper_key.get('plan_type') or 'vpn_regular'
        try:
            if keeper_key.get('key_uuid'):
                remnawave.remnawave_api.update_user_sync(
                    uuid=keeper_key['key_uuid'],
                    expire_at=new_expiry,
                    hwid_device_limit=total_devices,
                    telegram_id=primary.get('telegram_id') or secondary.get('telegram_id'),
                    email=primary.get('email') or secondary.get('email'),
                )
        except Exception as e:
            logger.error('Remnawave update during merge failed: %s', e)

        if primary_key and primary_key['id'] == keeper_key['id']:
            database.update_vpn_key(
                primary_key['id'],
                expiry_date=new_expiry.isoformat(),
                devices_limit=total_devices,
                status='Active',
            )
            if secondary_key and secondary_key['id'] != primary_key['id']:
                try:
                    if secondary_key.get('key_uuid'):
                        remnawave.remnawave_api.delete_user_sync(secondary_key['key_uuid'])
                except Exception:
                    pass
                database.update_vpn_key(secondary_key['id'], status='Deleted')
                database.delete_vpn_key(secondary_key['id'])
        else:
            # Move secondary key to primary user
            database.update_vpn_key(
                keeper_key['id'],
                expiry_date=new_expiry.isoformat(),
                devices_limit=total_devices,
                status='Active',
            )
            conn = database.get_db_connection()
            try:
                conn.execute('UPDATE vpn_keys SET user_id = ? WHERE id = ?', (primary_user_id, keeper_key['id']))
                conn.commit()
            finally:
                conn.close()
            if primary_key and primary_key['id'] != keeper_key['id']:
                try:
                    if primary_key.get('key_uuid'):
                        remnawave.remnawave_api.delete_user_sync(primary_key['key_uuid'])
                except Exception:
                    pass
                database.delete_vpn_key(primary_key['id'])

    # Merge identity fields onto primary
    email = primary.get('email') or secondary.get('email')
    password_hash = primary.get('password_hash') or secondary.get('password_hash')
    email_verified = primary.get('email_verified_at') or secondary.get('email_verified_at')
    telegram_id = primary.get('telegram_id') or secondary.get('telegram_id')
    username = primary.get('username') or secondary.get('username')
    full_name = primary.get('full_name') or secondary.get('full_name')

    # Clear secondary unique fields before transfer/delete
    database.set_user_email(secondary_user_id, email=None, verified=False)
    database.set_user_telegram_id(secondary_user_id, telegram_id=None)

    if email and not primary.get('email'):
        database.set_user_email(primary_user_id, email=email, password_hash=password_hash, verified=bool(email_verified))
    elif password_hash and not primary.get('password_hash'):
        database.set_user_email(primary_user_id, email=primary.get('email'), password_hash=password_hash, verified=bool(primary.get('email_verified_at')))

    if telegram_id and not primary.get('telegram_id'):
        database.set_user_telegram_id(primary_user_id, telegram_id=telegram_id, username=username, full_name=full_name)

    database.transfer_user_assets(secondary_user_id, primary_user_id)

    # Remaining vpn_keys of secondary → primary then delete secondary user
    conn = database.get_db_connection()
    try:
        conn.execute('UPDATE vpn_keys SET user_id = ? WHERE user_id = ?', (primary_user_id, secondary_user_id))
        conn.commit()
    finally:
        conn.close()

    try:
        database.purge_user_from_database(secondary_user_id)
    except Exception as e:
        logger.error('purge secondary user failed: %s', e)
        return (False, f'Объединение частично выполнено, ошибка удаления: {e}')

    logger.info(
        'Merged user %s into %s (days=%s devices=%s)',
        secondary_user_id, primary_user_id, total_days, total_devices,
    )
    return (True, 'Аккаунты объединены')
