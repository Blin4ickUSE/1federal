import logging
import os
from datetime import datetime, timedelta
from typing import Dict, Optional

from flask import Flask, jsonify, request

from backend.api import platega, remnawave
from backend.core import core
from backend.database import database

logger = logging.getLogger(__name__)
app = Flask(__name__)


def notify_admin_about_deposit(user: Dict, amount: float, method: str, provider: str):
    username = user.get('username', 'N/A')
    telegram_id = user.get('telegram_id', 'N/A')
    message = (
        f'💰 <b>Пополнение баланса</b>\n\n'
        f'👤 Пользователь: @{username}\n'
        f'🆔 Telegram ID: {telegram_id}\n'
        f'💵 Сумма: {amount}₽\n'
        f'💳 Способ: {method}\n'
        f'🏦 Провайдер: {provider}'
    )
    core.send_notification_to_admin(message)


def _webhook_field(data: dict, *names):
    for name in names:
        if name in data and data.get(name) is not None:
            return data.get(name)
    return None


def _apply_deposit(user_id: int, amount: float, method_name: str, payment_id: str):
    bonus_amount = 0
    bonus_name = None
    try:
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT * FROM auto_discounts
            WHERE is_active = 1 AND condition_type = 'payment_amount'
            ORDER BY CAST(condition_value AS REAL) DESC
            """
        )
        discounts = cursor.fetchall()
        for discount in discounts:
            try:
                min_amount = float(discount['condition_value'])
                if amount >= min_amount:
                    if discount['discount_type'] == 'percent':
                        bonus_amount = round(amount * float(discount['discount_value']) / 100, 2)
                    else:
                        bonus_amount = float(discount['discount_value'])
                    bonus_name = discount['name']
                    break
            except (ValueError, TypeError):
                continue
        if bonus_amount == 0:
            cursor.execute(
                """
                SELECT * FROM auto_discounts
                WHERE is_active = 1 AND condition_type = 'payment_method'
                  AND LOWER(condition_value) = LOWER(?)
                """,
                (method_name,),
            )
            method_discount = cursor.fetchone()
            if method_discount:
                if method_discount['discount_type'] == 'percent':
                    bonus_amount = round(amount * float(method_discount['discount_value']) / 100, 2)
                else:
                    bonus_amount = float(method_discount['discount_value'])
                bonus_name = method_discount['name']
        conn.close()
    except Exception as exc:
        logger.error('Error checking auto-discounts for Platega: %s', exc)

    total_amount = amount + bonus_amount
    database.update_user_balance(user_id, total_amount)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)
        VALUES (?, 'deposit', ?, 'Success', ?, 'Platega', ?)
        """,
        (user_id, total_amount, method_name, payment_id),
    )
    if bonus_amount > 0:
        cursor.execute(
            """
            INSERT INTO transactions (user_id, type, amount, status, description)
            VALUES (?, 'bonus', ?, 'Success', ?)
            """,
            (user_id, bonus_amount, f'Бонус: {bonus_name}'),
        )
    conn.commit()
    conn.close()

    user = database.get_user_by_id(user_id)
    if user:
        if bonus_amount > 0:
            msg = f'✅ Баланс пополнен на {amount}₽ + бонус {bonus_amount}₽ через Platega ({method_name})'
        else:
            msg = f'✅ Баланс пополнен на {amount}₽ через Platega ({method_name})'
        core.send_notification_to_user(user['telegram_id'], msg)
        notify_admin_about_deposit(user, amount, method_name, 'Platega')


def _extend_vpn_key_days(user_id: int, key_id: int, days: int, amount: float) -> bool:
    """Продлить VPN-ключ на days дней после успешного рекуррентного списания."""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'SELECT id, key_uuid, expiry_date FROM vpn_keys WHERE id = ? AND user_id = ?',
            (key_id, user_id),
        )
        key_row = cursor.fetchone()
        if not key_row:
            # fallback: любой активный ключ пользователя
            cursor.execute(
                """
                SELECT id, key_uuid, expiry_date FROM vpn_keys
                WHERE user_id = ? AND status = 'Active'
                ORDER BY id DESC LIMIT 1
                """,
                (user_id,),
            )
            key_row = cursor.fetchone()
        if not key_row:
            logger.warning('Auto-renew: no vpn key for user %s', user_id)
            return False

        key_id = key_row['id']
        key_uuid = key_row['key_uuid']
        current_expiry = key_row['expiry_date']
        if current_expiry:
            try:
                expiry_dt = datetime.fromisoformat(str(current_expiry).replace('Z', '+00:00').replace('+00:00', ''))
            except Exception:
                expiry_dt = datetime.now()
            if expiry_dt < datetime.now():
                new_expiry = datetime.now() + timedelta(days=days)
            else:
                new_expiry = expiry_dt + timedelta(days=days)
        else:
            new_expiry = datetime.now() + timedelta(days=days)

        if key_uuid:
            try:
                remnawave.remnawave_api.update_user_sync(
                    uuid=key_uuid,
                    expire_at=new_expiry,
                    status=remnawave.UserStatus.ACTIVE,
                )
            except Exception as e:
                logger.error('Auto-renew Remnawave update failed: %s', e)
                return False

        new_expiry_str = new_expiry.isoformat()
        cursor.execute(
            "UPDATE vpn_keys SET status = 'Active', expiry_date = ? WHERE id = ?",
            (new_expiry_str, key_id),
        )
        cursor.execute(
            """
            INSERT INTO transactions (user_id, type, amount, status, description, payment_method, duration_days)
            VALUES (?, 'subscription_extend', ?, 'Success', ?, 'СБП подписка', ?)
            """,
            (user_id, -float(amount), f'Автопродление подписки ({days} дн.)', int(days)),
        )
        conn.commit()
        database.link_platega_subscription_to_vpn_key(user_id, int(key_id))
        user = database.get_user_by_id(user_id)
        if user:
            core.send_notification_to_user(
                user['telegram_id'],
                f'✅ Подписка автоматически продлена на {days} дн.\n'
                f'📅 Новая дата окончания: {new_expiry.strftime("%d.%m.%Y")}\n'
                f'💳 Списано: {amount:.0f}₽',
            )
        return True
    except Exception as e:
        logger.error('Auto-renew extend error: %s', e)
        return False
    finally:
        conn.close()


def _handle_subscription_status(data: dict) -> None:
    status = str(_webhook_field(data, 'Status', 'status') or '').upper()
    subscription_id = str(
        _webhook_field(data, 'SubscriptionId', 'subscriptionId', 'Id', 'id') or ''
    )
    if not subscription_id:
        logger.error('Platega subscription status: missing subscription id')
        return

    next_charge = _webhook_field(data, 'NextChargeAt', 'nextChargeAt')
    local = database.get_platega_subscription(subscription_id)
    if not local:
        logger.warning('Platega subscription status for unknown id=%s', subscription_id)
        return

    status_map = {
        'SUBSCRIPTION_ACTIVATED': 'ACTIVE',
        'SUBSCRIPTION_PAST_DUE': 'PAST_DUE',
        'SUBSCRIPTION_CANCELLED': 'CANCELLED',
        'SUBSCRIPTION_FAILED': 'FAILED',
    }
    new_status = status_map.get(status)
    if not new_status:
        logger.info('Platega subscription status ignored: %s', status)
        return

    database.update_platega_subscription(
        subscription_id,
        status=new_status,
        next_charge_at=str(next_charge) if next_charge else None,
    )

    user = database.get_user_by_id(local['user_id'])
    if not user:
        return

    if new_status == 'ACTIVE':
        core.send_notification_to_user(
            user['telegram_id'],
            '✅ Автопродление подключено. Деньги будут списываться автоматически.',
        )
    elif new_status == 'PAST_DUE':
        core.send_notification_to_user(
            user['telegram_id'],
            '⚠️ Не удалось списать оплату за подписку. Проверьте счёт СБП — платёж будет повторён.',
        )
    elif new_status == 'CANCELLED':
        core.send_notification_to_user(
            user['telegram_id'],
            'ℹ️ Автопродление подписки отключено. Текущий период действует до даты окончания.',
        )
    elif new_status == 'FAILED':
        core.send_notification_to_user(
            user['telegram_id'],
            '❌ Не удалось активировать автопродление. Попробуйте оформить подписку снова.',
        )


def _handle_confirmed_charge(data: dict) -> None:
    transaction_id = str(_webhook_field(data, 'Id', 'id', 'transactionId') or '')
    if not transaction_id:
        logger.error('Platega webhook: missing transaction id')
        return

    amount = float(_webhook_field(data, 'Amount', 'amount') or 0)
    payment_method = _webhook_field(data, 'PaymentMethod', 'paymentMethod')
    payload = _webhook_field(data, 'Payload', 'payload')
    subscription_id = str(_webhook_field(data, 'SubscriptionId', 'subscriptionId') or '')
    next_charge = _webhook_field(data, 'NextChargeAt', 'nextChargeAt')

    user_id = platega.platega_api.extract_user_id(payload)
    local_sub = database.get_platega_subscription(subscription_id) if subscription_id else None
    if local_sub:
        user_id = user_id or int(local_sub['user_id'])

    if not user_id:
        tx = platega.platega_api.get_transaction(transaction_id)
        user_id = platega.platega_api.extract_user_id(transaction=tx)
        if isinstance(tx, dict):
            if amount <= 0 and isinstance(tx.get('paymentDetails'), dict):
                amount = float(tx['paymentDetails'].get('amount', 0) or 0)
            if payment_method is None:
                payment_method = tx.get('paymentMethod')

    if not user_id:
        logger.error('Platega webhook: cannot extract user_id for tx=%s', transaction_id)
        return

    if amount <= 0 and local_sub:
        amount = float(local_sub.get('amount') or 0)

    if amount <= 0:
        logger.error('Platega webhook: invalid amount for tx=%s', transaction_id)
        return

    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id FROM transactions WHERE payment_id = ? AND payment_provider = 'Platega'",
        (transaction_id,),
    )
    existing = cursor.fetchone()
    conn.close()
    if existing:
        logger.info('Platega payment %s already processed', transaction_id)
        return

    method_name = platega.platega_api.method_name_from_code(payment_method)
    _apply_deposit(user_id, amount, method_name, transaction_id)

    if local_sub:
        was_charged_before = bool(local_sub.get('last_charge_at'))
        database.update_platega_subscription(
            subscription_id,
            status='ACTIVE',
            next_charge_at=str(next_charge) if next_charge else None,
            last_charge_at=datetime.utcnow().isoformat(),
        )
        # Повторные списания (не первое): продлеваем VPN на сервере.
        # Первое списание активирует подписку через миниапп после роста баланса.
        if was_charged_before:
            vpn_key_id = local_sub.get('vpn_key_id')
            days = int(local_sub.get('duration_days') or 30)
            if _extend_vpn_key_days(user_id, int(vpn_key_id or 0), days, amount):
                database.update_user_balance(user_id, -float(amount), ensure_non_negative=True)
                logger.info(
                    'Platega auto-renew extended user=%s sub=%s days=%s',
                    user_id, subscription_id, days,
                )

    logger.info('Platega payment %s processed: %s RUB for user %s', transaction_id, amount, user_id)


@app.route('/platega', methods=['POST'])
def platega_webhook():
    try:
        data = request.get_json(silent=True) or {}
        logger.info('Platega webhook: %s', data)

        merchant_id = request.headers.get('X-MerchantId', '')
        secret = request.headers.get('X-Secret', '')
        if platega.platega_api.is_configured and not platega.platega_api.verify_webhook(merchant_id, secret):
            logger.error('Platega webhook: invalid credentials')
            return jsonify({'error': 'Unauthorized'}), 401

        status = str(_webhook_field(data, 'Status', 'status') or '').upper()

        if status in platega.PLATEGA_SUBSCRIPTION_STATUSES:
            _handle_subscription_status(data)
            return jsonify({'status': 'ok'}), 200

        if status == 'CONFIRMED':
            _handle_confirmed_charge(data)
            return jsonify({'status': 'ok'}), 200

        if status == 'CANCELED' and _webhook_field(data, 'SubscriptionId', 'subscriptionId'):
            subscription_id = str(_webhook_field(data, 'SubscriptionId', 'subscriptionId'))
            database.update_platega_subscription(subscription_id, status='PAST_DUE', next_charge_at=None)
            logger.info('Platega recurring charge canceled for sub=%s', subscription_id)
            return jsonify({'status': 'ok'}), 200

        return jsonify({'status': 'ok'}), 200
    except Exception as exc:
        logger.error('Platega webhook error: %s', exc)
        return jsonify({'error': str(exc)}), 500


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'platega_configured': platega.platega_api.is_configured})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))
