"""CloudPayments webhook notifications (Pay / Fail / Recurrent)."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional
from urllib.parse import parse_qs

from flask import Flask, jsonify, request

from backend.api import cloudpayments, recurring
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


def _field(data: dict, *names):
    for name in names:
        if name in data and data.get(name) is not None and data.get(name) != '':
            return data.get(name)
    # case-insensitive
    lower_map = {str(k).lower(): v for k, v in data.items()}
    for name in names:
        key = str(name).lower()
        if key in lower_map and lower_map[key] is not None and lower_map[key] != '':
            return lower_map[key]
    return None


def _parse_data_json(raw) -> dict:
    if raw is None or raw == '':
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _parse_request_payload() -> tuple[dict, bytes]:
    raw_body = request.get_data(cache=True) or b''
    data: dict = {}
    if request.is_json:
        data = request.get_json(silent=True) or {}
    elif request.form:
        data = {k: request.form.get(k) for k in request.form.keys()}
    else:
        # application/x-www-form-urlencoded raw
        try:
            text = raw_body.decode('utf-8')
            qs = parse_qs(text, keep_blank_values=True)
            data = {k: (v[0] if isinstance(v, list) and v else v) for k, v in qs.items()}
        except Exception:
            data = {}
    return data, raw_body


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
        conn.close()
    except Exception as exc:
        logger.error('Error checking auto-discounts: %s', exc)

    total_amount = amount + bonus_amount
    database.update_user_balance(user_id, total_amount)
    database.insert_deposit_transaction(user_id, total_amount, method_name, payment_id, 'CloudPayments')
    if bonus_amount > 0:
        conn = database.get_db_connection()
        cursor = conn.cursor()
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
            msg = f'✅ Баланс пополнен на {amount}₽ + бонус {bonus_amount}₽ ({method_name})'
        else:
            msg = f'✅ Баланс пополнен на {amount}₽ ({method_name})'
        core.send_notification_to_user(user['telegram_id'], msg)
        notify_admin_about_deposit(user, amount, method_name, 'CloudPayments')


def _handle_pay(data: dict) -> None:
    transaction_id = str(_field(data, 'TransactionId', 'transactionId') or '')
    amount = float(_field(data, 'Amount', 'amount', 'PaymentAmount') or 0)
    account_id = str(_field(data, 'AccountId', 'accountId') or '')
    invoice_id = str(_field(data, 'InvoiceId', 'invoiceId', 'ExternalId', 'externalId') or '')
    token = str(_field(data, 'Token', 'token') or '')
    card_last4 = str(_field(data, 'CardLastFour', 'cardLastFour') or '') or None
    card_brand = str(_field(data, 'CardType', 'cardType') or '') or None
    subscription_id_cp = str(_field(data, 'SubscriptionId', 'subscriptionId') or '')
    data_json = _parse_data_json(_field(data, 'Data', 'data'))

    if transaction_id and database.transaction_exists_by_payment_id(transaction_id, 'CloudPayments'):
        logger.info('CP Pay already processed tx=%s', transaction_id)
        return

    # Автосписание нашего job: не кладём на баланс, только продлеваем VPN (идемпотентно по tx).
    kind = str(data_json.get('kind') or '')
    sub_id_from_data = str(data_json.get('subscription_id') or '')
    if kind == 'recurring_renewal' or invoice_id.startswith('renew_'):
        if transaction_id and database.transaction_exists_by_payment_id(transaction_id, 'CloudPayments'):
            return
        sub = database.get_recurring_subscription(sub_id_from_data) if sub_id_from_data else None
        if not sub and invoice_id.startswith('renew_'):
            # renew_{sub_id}_{suffix}
            parts = invoice_id.split('_')
            if len(parts) >= 2:
                maybe = '_'.join(parts[1:-1]) if len(parts) > 2 else parts[1]
                sub = database.get_recurring_subscription(maybe) or database.get_recurring_subscription(
                    'rcp_' + parts[1] if not maybe.startswith('rcp_') else maybe
                )
        if sub and sub.get('status') in ('ACTIVE', 'PAST_DUE'):
            recurring.handle_successful_charge(sub, transaction_id=transaction_id, amount=amount)
        return

    intent = database.get_payment_intent(invoice_id) if invoice_id else None
    user_id: Optional[int] = None
    if intent:
        user_id = int(intent['user_id'])
    elif account_id.isdigit():
        user_id = int(account_id)
    elif str(data_json.get('user_id') or '').isdigit():
        user_id = int(data_json['user_id'])

    if not user_id:
        logger.error('CP Pay: cannot resolve user_id invoice=%s account=%s', invoice_id, account_id)
        return

    if amount <= 0 and intent:
        amount = float(intent.get('amount') or 0)
    if amount <= 0:
        logger.error('CP Pay: invalid amount tx=%s', transaction_id)
        return

    method_name = str(_field(data, 'PaymentMethod', 'paymentMethod') or 'Карта')
    if method_name.lower() in ('', 'card', 'cards'):
        method_name = 'Карта'

    _apply_deposit(user_id, amount, method_name, transaction_id or invoice_id)

    saved_method_id = None
    if token:
        saved_method_id = recurring.save_card_token(user_id, token, card_last4, card_brand)

    if intent and intent.get('status') != 'paid':
        database.mark_payment_intent_paid(invoice_id, transaction_id)
        is_trial = bool(int(intent.get('is_trial') or 0))
        # Автопродление: карта привязана, следующий платёж по расписанию
        if token or saved_method_id:
            recurring.create_recurring_after_first_payment(
                user_id=user_id,
                amount=float(intent.get('amount') or amount),
                duration_days=int(intent.get('days') or 30),
                plan_type=str(intent.get('plan_type') or 'vpn_regular'),
                tariff_category=str(intent.get('tariff_category') or 'regular'),
                devices_limit=int(intent.get('devices_limit') or 2),
                action_type=str(intent.get('action_type') or 'wizard'),
                vpn_key_id=int(intent['vpn_key_id']) if intent.get('vpn_key_id') else None,
                card_token=token or None,
                saved_method_id=saved_method_id,
                is_trial=is_trial,
            )

    if subscription_id_cp:
        logger.info('CP Pay with SubscriptionId=%s (managed by CP schedule — ignored for custom retries)', subscription_id_cp)

    logger.info('CP Pay processed tx=%s user=%s amount=%s', transaction_id, user_id, amount)


def _handle_fail(data: dict) -> None:
    invoice_id = str(_field(data, 'InvoiceId', 'invoiceId') or '')
    account_id = str(_field(data, 'AccountId', 'accountId') or '')
    data_json = _parse_data_json(_field(data, 'Data', 'data'))
    reason = str(_field(data, 'Reason', 'reason') or '')
    sub_id = str(data_json.get('subscription_id') or _field(data, 'SubscriptionId', 'subscriptionId') or '')

    if sub_id:
        sub = database.get_recurring_subscription(sub_id)
        if sub and sub.get('status') in ('ACTIVE', 'PAST_DUE'):
            # Не дублируем, если job уже поставил ретрай; webhook Fail — страховка
            if int(sub.get('retry_count') or 0) == 0 and sub.get('status') == 'ACTIVE':
                recurring.handle_failed_charge(sub, reason=reason)
            return

    # Первичный платёж через виджет — уведомляем один раз (миниапп покажет ошибку сам)
    logger.info('CP Fail invoice=%s account=%s reason=%s', invoice_id, account_id, reason)


def _handle_recurrent(data: dict) -> None:
    """Статус CP-подписки — мы управляем списаниями сами, только логируем."""
    status = str(_field(data, 'Status', 'status') or '')
    sub_id = str(_field(data, 'Id', 'id') or '')
    account_id = str(_field(data, 'AccountId', 'accountId') or '')
    logger.info('CP Recurrent notification id=%s account=%s status=%s', sub_id, account_id, status)


@app.route('/cloudpayments', methods=['POST'])
@app.route('/cloudpayments/<event>', methods=['POST'])
def cloudpayments_webhook(event: str = None):
    try:
        data, raw_body = _parse_request_payload()
        content_hmac = request.headers.get('Content-HMAC', '') or request.headers.get('Content-Hmac', '')
        x_content_hmac = request.headers.get('X-Content-HMAC', '') or request.headers.get('X-Content-Hmac', '')

        if cloudpayments.cloudpayments_api.is_configured:
            if not cloudpayments.cloudpayments_api.verify_webhook_hmac(raw_body, content_hmac, x_content_hmac):
                # Некоторые инсталляции шлют без HMAC в тестовом режиме — не блокируем жёстко, если секрет пустой уже обработан
                if content_hmac or x_content_hmac:
                    return jsonify({'code': 13}), 401

        event_name = (event or request.args.get('event') or '').lower()
        # Определяем тип по полям, если path без event
        if not event_name:
            if _field(data, 'ReasonCode', 'reasonCode') is not None and _field(data, 'Reason', 'reason'):
                # Fail имеет Reason; Pay тоже может — смотрим Status
                status = str(_field(data, 'Status', 'status') or '')
                if status in ('Declined', 'Cancelled', ''):
                    if _field(data, 'Reason', 'reason') and not status:
                        event_name = 'fail'
            if _field(data, 'Interval', 'interval') and _field(data, 'Id', 'id') and _field(data, 'SuccessfulTransactionsNumber') is not None:
                event_name = 'recurrent'
            if not event_name:
                status = str(_field(data, 'Status', 'status') or '')
                if status in ('Completed', 'Authorized', 'Paid'):
                    event_name = 'pay'
                elif status in ('Declined',):
                    event_name = 'fail'
                else:
                    # По умолчанию Pay (основной хук)
                    event_name = 'pay'

        logger.info('CP webhook event=%s data_keys=%s', event_name, list(data.keys())[:20])

        if event_name in ('pay', 'confirm'):
            _handle_pay(data)
        elif event_name == 'fail':
            _handle_fail(data)
        elif event_name == 'recurrent':
            _handle_recurrent(data)
        elif event_name == 'check':
            return jsonify({'code': 0})
        else:
            logger.info('CP webhook ignored event=%s', event_name)

        return jsonify({'code': 0})
    except Exception as exc:
        logger.error('CP webhook error: %s', exc)
        return jsonify({'code': 0})  # не зацикливаем ретраи CP


# Legacy path — redirect handlers for old nginx configs during migration
@app.route('/platega', methods=['POST'])
def platega_legacy():
    logger.warning('Received /platega webhook — Platega removed, use /cloudpayments')
    return jsonify({'error': 'Platega disabled, use CloudPayments'}), 410


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'ok',
        'cloudpayments_configured': cloudpayments.cloudpayments_api.is_configured,
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))
