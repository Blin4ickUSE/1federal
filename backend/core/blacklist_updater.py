import os
import requests
import logging
import time
import threading
from backend.database import database
logger = logging.getLogger(__name__)
BLACKLIST_URL = 'https://raw.githubusercontent.com/Blin4ickUSE/ban-vpn/refs/heads/main/blacklist.txt'
UPDATE_INTERVAL = 3600

def update_blacklist():
    try:
        response = requests.get(BLACKLIST_URL, timeout=10)
        response.raise_for_status()
        telegram_ids = []
        for line in response.text.strip().split('\n'):
            line = line.strip()
            if line and line.isdigit():
                telegram_ids.append(int(line))
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM blacklist')
        for telegram_id in telegram_ids:
            try:
                cursor.execute('INSERT OR IGNORE INTO blacklist (telegram_id) VALUES (?)', (telegram_id,))
                cursor.execute(
                    """
                    UPDATE users
                    SET is_banned = 1, ban_reason = 'Чёрный список'
                    WHERE telegram_id = ? AND (is_banned = 0 OR is_banned IS NULL)
                    """,
                    (telegram_id,),
                )
            except Exception as e:
                logger.warning(f'Failed to add {telegram_id} to blacklist: {e}')
        conn.commit()
        conn.close()
        logger.info(f'Blacklist updated: {len(telegram_ids)} entries')
        return len(telegram_ids)
    except Exception as e:
        logger.error(f'Failed to update blacklist: {e}')
        return 0

def blacklist_updater_worker():
    while True:
        try:
            update_blacklist()
        except Exception as e:
            logger.error(f'Blacklist updater error: {e}')
        time.sleep(UPDATE_INTERVAL)

def start_blacklist_updater():
    update_blacklist()
    thread = threading.Thread(target=blacklist_updater_worker, daemon=True)
    thread.start()
    logger.info('Blacklist updater started')
