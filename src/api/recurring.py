"""Управление рекуррентными подписками.

С переходом на Platega весь планировщик списаний и retry-логика убраны:
Platega полностью управляет расписанием и повторами через СБП-подписку.

Оставлены только:
  - deactivate_card_and_cancel_recurring — отмена подписки через API Platega
    и пометка в БД (вызывается из server.py при удалении метода оплаты)
  - Остальные функции продления/списания живут в platega.py
"""

from __future__ import annotations

import logging
from typing import Optional

from src.database import database

logger = logging.getLogger(__name__)


def deactivate_card_and_cancel_recurring(user_id: int, method_id: int) -> bool:
    """Отменить подписку пользователя и пометить метод оплаты неактивным.

    В Platega рекуррент управляется на стороне провайдера через СБП-подписку.
    Если в БД есть subscription_id — отменяем через API Platega, потом помечаем в БД.
    """
    from src.api import platega

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        # Ищем активные подписки пользователя
        cursor.execute(
            """
            SELECT subscription_id FROM recurring_subscriptions
            WHERE user_id = ?
              AND status IN ('PENDING', 'ACTIVE', 'PAST_DUE')
            ORDER BY created_at DESC
            """,
            (user_id,),
        )
        subs = [row['subscription_id'] for row in cursor.fetchall()]

        cancelled_count = 0
        for sub_id in subs:
            # Отмена в Platega (идемпотентна)
            try:
                result = platega.platega_api.cancel_subscription(sub_id)
                if result.get('ok'):
                    logger.info('Platega subscription %s cancelled via API', sub_id)
                else:
                    logger.warning('Platega cancel sub %s: %s', sub_id, result.get('error'))
            except Exception as exc:
                logger.error('Platega cancel sub %s error: %s', sub_id, exc)

            # Помечаем в БД в любом случае
            cursor.execute(
                """
                UPDATE recurring_subscriptions
                SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
                WHERE subscription_id = ?
                """,
                (sub_id,),
            )
            cancelled_count += 1

        # Метод оплаты — в Platega токенов карт нет, но запись в saved_payment_methods
        # могла быть создана. Деактивируем если method_id > 0.
        if method_id:
            cursor.execute(
                """
                UPDATE saved_payment_methods
                SET is_active = 0, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
                """,
                (method_id, user_id),
            )
            if cursor.rowcount == 0:
                # method_id не нашёлся — но подписки мы уже отменили, это ок
                if cancelled_count == 0:
                    conn.commit()
                    return False

        conn.commit()
        return True
    except Exception as exc:
        logger.error('deactivate_card_and_cancel_recurring error: %s', exc)
        return False
    finally:
        conn.close()
