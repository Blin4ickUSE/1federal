import logging
import os
from typing import Dict

from flask import Flask, jsonify, request

from backend.api import platega
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

        status = str(data.get('status', '')).upper()
        if status not in {'CONFIRMED'}:
            return jsonify({'status': 'ok'}), 200

        transaction_id = str(data.get('id') or data.get('transactionId') or '')
        if not transaction_id:
            logger.error('Platega webhook: missing transaction id')
            return jsonify({'status': 'ok'}), 200

        amount = float(data.get('amount', 0) or 0)
        payment_method = data.get('paymentMethod')

        user_id = platega.platega_api.extract_user_id(data.get('payload'))
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
            return jsonify({'status': 'ok'}), 200

        if amount <= 0:
            logger.error('Platega webhook: invalid amount for tx=%s', transaction_id)
            return jsonify({'status': 'ok'}), 200

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
            return jsonify({'status': 'ok'}), 200

        method_name = platega.platega_api.method_name_from_code(payment_method)
        _apply_deposit(user_id, amount, method_name, transaction_id)
        logger.info('Platega payment %s processed: %s RUB for user %s', transaction_id, amount, user_id)
        return jsonify({'status': 'ok'}), 200
    except Exception as exc:
        logger.error('Platega webhook error: %s', exc)
        return jsonify({'error': str(exc)}), 500


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'platega_configured': platega.platega_api.is_configured})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))
