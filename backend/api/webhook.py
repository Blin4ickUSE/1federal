import os
import logging
import asyncio
from typing import Dict, Any, Optional
from flask import Flask, request, jsonify
from backend.api import platega
from backend.database import database
from backend.core import core
logger = logging.getLogger(__name__)
app = Flask(__name__)

def notify_admin_about_deposit(user: Dict, amount: float, method: str, provider: str):
    username = user.get('username', 'N/A')
    telegram_id = user.get('telegram_id', 'N/A')
    message = f'💰 <b>Пополнение баланса</b>\n\n👤 Пользователь: @{username}\n🆔 Telegram ID: {telegram_id}\n💵 Сумма: {amount}₽\n💳 Способ: {method}\n🏦 Провайдер: {provider}'
    core.send_notification_to_admin(message)

@app.route('/platega', methods=['POST'])

def platega_webhook():
    try:
        data = request.json
        logger.info(f'Platega webhook: {data}')
        received_merchant = request.headers.get('X-MerchantId', '')
        received_secret = request.headers.get('X-Secret', '')
        if platega.platega_api.is_configured:
            if received_merchant != platega.platega_api.merchant_id or received_secret != platega.platega_api.secret_key:
                logger.error('Platega webhook: неверные X-MerchantId или X-Secret')
                return (jsonify({'error': 'Unauthorized'}), 401)
        status = str(data.get('status', '')).upper()
        transaction_id = data.get('id')
        payload = data.get('payload', '')
        amount = float(data.get('amount', 0))
        if status == 'CONFIRMED':
            user_id = None
            if payload:
                clean_payload = payload.replace('platega:', '') if payload.startswith('platega:') else payload
                parts = clean_payload.split('_')
                if len(parts) >= 2 and parts[0] == 'platega':
                    try:
                        user_id = int(parts[1])
                    except ValueError:
                        pass
            if not user_id:
                logger.error(f'Platega webhook: не удалось извлечь user_id из payload {payload}')
                return (jsonify({'status': 'ok'}), 200)
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM transactions WHERE payment_id = ? AND payment_provider = 'Platega'", (transaction_id,))
            existing = cursor.fetchone()
            conn.close()
            if existing:
                logger.info(f'Platega платеж {transaction_id} уже обработан')
                return (jsonify({'status': 'ok'}), 200)
            payment_method = data.get('paymentMethod', 0)
            if payment_method == 2:
                method_name = 'СБП'
            elif payment_method in (10, 11, 12):
                method_name = 'Карта'
            elif payment_method == 13:
                method_name = 'Крипто'
            else:
                method_name = 'Platega'
            bonus_amount = 0
            bonus_name = None
            try:
                conn = database.get_db_connection()
                cursor = conn.cursor()
                cursor.execute("\n                    SELECT * FROM auto_discounts \n                    WHERE is_active = 1 AND condition_type = 'payment_amount'\n                    ORDER BY CAST(condition_value AS REAL) DESC\n                ")
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
                    cursor.execute("\n                        SELECT * FROM auto_discounts \n                        WHERE is_active = 1 AND condition_type = 'payment_method'\n                          AND LOWER(condition_value) = LOWER(?)\n                    ", (method_name,))
                    method_discount = cursor.fetchone()
                    if method_discount:
                        if method_discount['discount_type'] == 'percent':
                            bonus_amount = round(amount * float(method_discount['discount_value']) / 100, 2)
                        else:
                            bonus_amount = float(method_discount['discount_value'])
                        bonus_name = method_discount['name']
                conn.close()
            except Exception as e:
                logger.error(f'Error checking auto-discounts for Platega: {e}')
            total_amount = amount + bonus_amount
            database.update_user_balance(user_id, total_amount)
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("\n                INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)\n                VALUES (?, 'deposit', ?, 'Success', ?, 'Platega', ?)\n            ", (user_id, total_amount, method_name, transaction_id))
            if bonus_amount > 0:
                cursor.execute("\n                    INSERT INTO transactions (user_id, type, amount, status, description)\n                    VALUES (?, 'bonus', ?, 'Success', ?)\n                ", (user_id, bonus_amount, f'Бонус: {bonus_name}'))
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
            logger.info(f'Platega платеж {transaction_id} успешно обработан: {amount}₽ для user {user_id}')
        return (jsonify({'status': 'ok'}), 200)
    except Exception as e:
        logger.error(f'Platega webhook error: {e}')
        return (jsonify({'error': str(e)}), 500)

@app.route('/health', methods=['GET'])

def health_check():
    return jsonify({'status': 'ok', 'platega_configured': platega.platega_api.is_configured})
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))
