import logging
import os
from typing import Dict

from flask import Flask, jsonify, request

from backend.api import lava
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
        logger.error('Error checking auto-discounts for Lava: %s', exc)

    total_amount = amount + bonus_amount
    database.update_user_balance(user_id, total_amount)
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)
        VALUES (?, 'deposit', ?, 'Success', ?, 'Lava', ?)
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
            msg = f'✅ Баланс пополнен на {amount}₽ + бонус {bonus_amount}₽ через Lava ({method_name})'
        else:
            msg = f'✅ Баланс пополнен на {amount}₽ через Lava ({method_name})'
        core.send_notification_to_user(user['telegram_id'], msg)
        notify_admin_about_deposit(user, amount, method_name, 'Lava')


@app.route('/lava', methods=['POST'])
def lava_webhook():
    try:
        raw_body = request.get_data() or b''
        data = request.get_json(silent=True) or {}
        logger.info('Lava webhook: %s', data)

        if lava.lava_api.is_configured:
            auth_header = request.headers.get('Authorization', '')
            if not lava.lava_api.verify_webhook(raw_body, auth_header):
                logger.error('Lava webhook: invalid signature')
                return jsonify({'error': 'Unauthorized'}), 401

        status = str(data.get('status', '')).lower()
        if status not in lava.LAVA_SUCCESS_STATUSES:
            return jsonify({'status': 'ok'}), 200

        invoice_id = data.get('invoice_id') or data.get('id')
        order_id = data.get('order_id') or data.get('orderId', '')
        amount = float(data.get('amount', 0) or 0)
        user_id = lava.lava_api.extract_user_id(order_id, data.get('custom_fields') or data.get('customFields'))
        if not user_id:
            logger.error('Lava webhook: cannot extract user_id from order_id=%s', order_id)
            return jsonify({'status': 'ok'}), 200

        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM transactions WHERE payment_id = ? AND payment_provider = 'Lava'",
            (invoice_id,),
        )
        existing = cursor.fetchone()
        conn.close()
        if existing:
            logger.info('Lava payment %s already processed', invoice_id)
            return jsonify({'status': 'ok'}), 200

        pay_service = str(data.get('pay_service', '')).lower()
        if pay_service == 'sbp':
            method_name = 'СБП'
        elif pay_service in ('card', 'bank_card'):
            method_name = 'Карта'
        else:
            method_name = 'Lava'

        _apply_deposit(user_id, amount, method_name, str(invoice_id))
        logger.info('Lava payment %s processed: %s RUB for user %s', invoice_id, amount, user_id)
        return jsonify({'status': 'ok'}), 200
    except Exception as exc:
        logger.error('Lava webhook error: %s', exc)
        return jsonify({'error': str(exc)}), 500


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'lava_configured': lava.lava_api.is_configured})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))
