from typing import Optional

from backend.core import core
from backend.database import database


def check_user_ban_status(user_id: int, telegram_id: Optional[int] = None) -> dict:
    user = database.get_user_by_id(user_id)
    if not user:
        return {'banned': False}

    tid = telegram_id if telegram_id is not None else user.get('telegram_id')
    if user.get('is_banned'):
        return {
            'banned': True,
            'reason': user.get('ban_reason') or 'Аккаунт заблокирован',
            'blacklisted': False,
        }

    if tid and core.check_blacklist(int(tid)):
        return {
            'banned': True,
            'reason': 'Доступ ограничён',
            'blacklisted': True,
        }

    return {'banned': False}
