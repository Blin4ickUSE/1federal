"""CloudPayments API client + webhook notification handlers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs

import requests
from flask import Request, jsonify

from src.api import recurring
from src.core import core
from src.database import database

logger = logging.getLogger(__name__)

CP_API_URL = os.getenv('CLOUDPAYMENTS_API_URL', 'https://api.cloudpayments.ru').rstrip('/')


class CloudPaymentsAPI:
    def __init__(self):
        self.reload_from_env()

    def reload_from_env(self):
        self.public_id = (os.getenv('CLOUDPAYMENTS_PUBLIC_ID') or '').strip()
        self.api_secret = (os.getenv('CLOUDPAYMENTS_API_SECRET') or '').strip()
        self.api_url = (os.getenv('CLOUDPAYMENTS_API_URL') or 'https://api.cloudpayments.ru').rstrip('/')

    @property
    def is_configured(self) -> bool:
        return bool(self.public_id and self.api_secret)

    def _auth_header(self) -> str:
        raw = f'{self.public_id}:{self.api_secret}'.encode('utf-8')
        return 'Basic ' + base64.b64encode(raw).decode('ascii')

    def _headers(self) -> Dict[str, str]:
        return {
            'Authorization': self._auth_header(),
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

    def verify_webhook_hmac(self, body: bytes, content_hmac: str = '', x_content_hmac: str = '') -> bool:
        """Verify Content-HMAC / X-Content-HMAC (HMAC-SHA256, base64, key = API Secret)."""
        if not self.api_secret:
            logger.warning('CloudPayments secret missing — webhook HMAC skipped')
            return False
        expected = base64.b64encode(
            hmac.new(self.api_secret.encode('utf-8'), body, hashlib.sha256).digest()
        ).decode('ascii')
        for received in (content_hmac, x_content_hmac):
            if received and hmac.compare_digest(expected, received.strip()):
                return True
        if not content_hmac and not x_content_hmac:
            logger.error('CloudPayments webhook without HMAC headers')
            return False
        logger.error('CloudPayments webhook HMAC mismatch')
        return False

    def charge_by_token(
        self,
        *,
        amount: float,
        account_id: str,
        token: str,
        invoice_id: str,
        description: str,
        currency: str = 'RUB',
        email: Optional[str] = None,
        json_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not self.is_configured:
            return {'ok': False, 'error': 'CloudPayments is not configured'}
        if not token:
            return {'ok': False, 'error': 'Missing card token'}

        payload: Dict[str, Any] = {
            'Amount': round(float(amount), 2),
            'Currency': currency,
            'AccountId': str(account_id),
            'Token': token,
            'InvoiceId': str(invoice_id),
            'Description': description or 'Оплата подписки',
        }
        if email:
            payload['Email'] = email
        if json_data:
            payload['JsonData'] = json_data

        url = f'{self.api_url}/payments/tokens/charge'
        try:
            response = requests.post(url, headers=self._headers(), json=payload, timeout=40)
            parsed: Optional[Dict[str, Any]] = None
            if response.content:
                try:
                    parsed = response.json()
                except Exception:
                    parsed = None

            if not isinstance(parsed, dict):
                logger.error('CP token charge unexpected response: %s', (response.text or '')[:500])
                return {'ok': False, 'error': 'unexpected response', 'raw': response.text}

            success = bool(parsed.get('Success'))
            model = parsed.get('Model') if isinstance(parsed.get('Model'), dict) else {}
            status = str(model.get('Status') or '')
            paid = success and status in ('Completed', 'Authorized', 'Paid')
            logger.info(
                'CP token charge invoice=%s success=%s status=%s tx=%s',
                invoice_id, success, status, model.get('TransactionId'),
            )
            return {
                'ok': paid,
                'success': success,
                'status': status,
                'transaction_id': str(model.get('TransactionId') or '') or None,
                'reason': parsed.get('Message') or model.get('Reason') or model.get('CardHolderMessage'),
                'model': model,
                'response': parsed,
            }
        except requests.exceptions.RequestException as exc:
            logger.error('CP token charge error: %s', exc)
            return {'ok': False, 'error': str(exc)}

    def refund_payment(
        self,
        *,
        transaction_id: str | int,
        amount: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Refund a CloudPayments payment by TransactionId (full or partial)."""
        if not self.is_configured:
            return {'ok': False, 'error': 'CloudPayments is not configured'}
        try:
            tx_id = int(str(transaction_id).strip())
        except (TypeError, ValueError):
            return {'ok': False, 'error': 'Invalid TransactionId'}

        payload: Dict[str, Any] = {'TransactionId': tx_id}
        if amount is not None:
            payload['Amount'] = round(float(amount), 2)

        url = f'{self.api_url}/payments/refund'
        try:
            response = requests.post(url, headers=self._headers(), json=payload, timeout=40)
            parsed: Optional[Dict[str, Any]] = None
            if response.content:
                try:
                    parsed = response.json()
                except Exception:
                    parsed = None
            if not isinstance(parsed, dict):
                logger.error('CP refund unexpected: %s', (response.text or '')[:500])
                return {'ok': False, 'error': 'unexpected response', 'raw': response.text}
            success = bool(parsed.get('Success'))
            model = parsed.get('Model') if isinstance(parsed.get('Model'), dict) else {}
            logger.info('CP refund tx=%s success=%s amount=%s', tx_id, success, amount)
            return {
                'ok': success,
                'success': success,
                'transaction_id': str(model.get('TransactionId') or tx_id),
                'reason': parsed.get('Message') or model.get('Reason'),
                'model': model,
                'response': parsed,
            }
        except requests.exceptions.RequestException as exc:
            logger.error('CP refund error: %s', exc)
            return {'ok': False, 'error': str(exc)}

    def create_order(
        self,
        *,
        amount: float,
        account_id: str,
        invoice_id: str,
        description: str,
        currency: str = 'RUB',
        email: Optional[str] = None,
        success_url: Optional[str] = None,
        fail_url: Optional[str] = None,
        json_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not self.is_configured:
            return {'ok': False, 'error': 'CloudPayments is not configured'}

        payload: Dict[str, Any] = {
            'Amount': round(float(amount), 2),
            'Currency': currency,
            'Description': description or 'Оплата подписки',
            'InvoiceId': str(invoice_id),
            'AccountId': str(account_id),
            'RequireConfirmation': False,
            'SendEmail': False,
            'CultureName': 'ru-RU',
        }
        if email:
            payload['Email'] = email
        if success_url:
            payload['SuccessRedirectUrl'] = success_url
        if fail_url:
            payload['FailRedirectUrl'] = fail_url
        if json_data:
            payload['JsonData'] = json_data

        url = f'{self.api_url}/orders/create'
        try:
            response = requests.post(url, headers=self._headers(), json=payload, timeout=30)
            parsed: Optional[Dict[str, Any]] = None
            if response.content:
                try:
                    parsed = response.json()
                except Exception:
                    parsed = None

            if not isinstance(parsed, dict):
                logger.error('CP orders/create unexpected: %s', (response.text or '')[:500])
                return {'ok': False, 'error': 'unexpected response', 'raw': response.text}

            if not parsed.get('Success'):
                msg = parsed.get('Message') or 'orders/create failed'
                logger.error('CP orders/create failed: %s', msg)
                return {'ok': False, 'error': msg, 'response': parsed}

            model = parsed.get('Model') if isinstance(parsed.get('Model'), dict) else {}
            pay_url = model.get('Url')
            if not pay_url:
                return {'ok': False, 'error': 'no payment url', 'response': parsed}

            logger.info(
                'CP order created id=%s invoice=%s amount=%s',
                model.get('Id'), invoice_id, amount,
            )
            return {
                'ok': True,
                'order_id': str(model.get('Id') or ''),
                'payment_url': str(pay_url),
                'invoice_id': invoice_id,
                'amount': round(float(amount), 2),
                'model': model,
            }
        except requests.exceptions.RequestException as exc:
            logger.error('CP orders/create error: %s', exc)
            return {'ok': False, 'error': str(exc)}

    def widget_params(
        self,
        *,
        amount: float,
        account_id: str,
        invoice_id: str,
        description: str,
        currency: str = 'RUB',
        email: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            'publicTerminalId': self.public_id,
            'publicId': self.public_id,
            'description': description,
            'amount': round(float(amount), 2),
            'currency': currency,
            'culture': 'ru-RU',
            'paymentSchema': 'Single',
            'skin': 'modern',
            'autoClose': 3,
            'externalId': str(invoice_id),
            'invoiceId': str(invoice_id),
            'accountId': str(account_id),
            'userInfo': {
                'accountId': str(account_id),
            },
        }
        if email:
            params['userInfo']['email'] = email
            params['email'] = email
        return params


cloudpayments_api = CloudPaymentsAPI()


# ── Webhook / notification handlers ─────────────────────────────────

def notify_admin_about_deposit(user: Dict, amount: float, method: str, provider: str):
    username = user.get('username', 'N/A')
    telegram_id = user.get('telegram_id') or '—'
    email = user.get('email') or '—'
    message = (
        f'💰 <b>Пополнение баланса</b> от @{username} ({telegram_id} / {email}) на {amount}₽ через {method}'
    )
    core.send_notification_to_admin(message)


def _field(data: dict, *names):
    for name in names:
        if name in data and data.get(name) is not None and data.get(name) != '':
            return data.get(name)
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


def parse_request_payload(request: Request) -> Tuple[dict, bytes]:
    raw_body = request.get_data(cache=True) or b''
    data: dict = {}
    if request.is_json:
        data = request.get_json(silent=True) or {}
    elif request.form:
        data = {k: request.form.get(k) for k in request.form.keys()}
    else:
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
    tx_id = database.insert_deposit_transaction(user_id, total_amount, method_name, payment_id, 'CloudPayments')
    # Developer share from real paid amount (без бонусов на баланс)
    try:
        database.accrue_developer_share(
            float(amount),
            source_transaction_id=tx_id,
            note=f'Доля с платежа {amount:.2f}₽ ({method_name})',
        )
    except Exception as exc:
        logger.error('Developer share accrual failed: %s', exc)
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
        if user.get('telegram_id'):
            core.send_notification_to_user(user['telegram_id'], msg)
        notify_admin_about_deposit(user, amount, method_name, 'CloudPayments')


def handle_pay(data: dict) -> None:
    transaction_id = str(_field(data, 'TransactionId', 'transactionId') or '')
    amount = float(_field(data, 'Amount', 'amount', 'PaymentAmount') or 0)
    account_id = str(_field(data, 'AccountId', 'accountId') or '')
    invoice_id = str(_field(data, 'InvoiceId', 'invoiceId', 'ExternalId', 'externalId') or '')
    token = str(_field(data, 'Token', 'token') or '')
    card_last4 = str(_field(data, 'CardLastFour', 'cardLastFour') or '') or None
    card_brand = str(_field(data, 'CardType', 'cardType') or '') or None
    subscription_id_cp = str(_field(data, 'SubscriptionId', 'subscriptionId') or '')
    data_json = _parse_data_json(_field(data, 'Data', 'data'))

    logger.info(
        'CP Pay start tx=%s invoice=%s account=%s amount=%s token=%s',
        transaction_id, invoice_id, account_id, amount, bool(token),
    )

    if transaction_id and database.transaction_exists_by_payment_id(transaction_id, 'CloudPayments'):
        logger.info('CP Pay already processed tx=%s', transaction_id)
        return

    kind = str(data_json.get('kind') or '')
    sub_id_from_data = str(data_json.get('subscription_id') or '')
    if kind == 'recurring_renewal' or invoice_id.startswith('renew_'):
        if transaction_id and database.transaction_exists_by_payment_id(transaction_id, 'CloudPayments'):
            return
        sub = database.get_recurring_subscription(sub_id_from_data) if sub_id_from_data else None
        if not sub and invoice_id.startswith('renew_'):
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
        else:
            logger.warning(
                'CP Pay: no card token for invoice=%s — recurring not created '
                '(включите «Сохранение токена карты» в ЛК CloudPayments)',
                invoice_id,
            )

    if subscription_id_cp:
        logger.info('CP Pay SubscriptionId=%s (ignored for custom retries)', subscription_id_cp)

    logger.info('CP Pay processed tx=%s user=%s amount=%s', transaction_id, user_id, amount)


def handle_fail(data: dict) -> None:
    invoice_id = str(_field(data, 'InvoiceId', 'invoiceId') or '')
    account_id = str(_field(data, 'AccountId', 'accountId') or '')
    data_json = _parse_data_json(_field(data, 'Data', 'data'))
    reason = str(_field(data, 'Reason', 'reason') or '')
    sub_id = str(data_json.get('subscription_id') or _field(data, 'SubscriptionId', 'subscriptionId') or '')

    logger.info('CP Fail invoice=%s account=%s reason=%s sub=%s', invoice_id, account_id, reason, sub_id)

    if sub_id:
        sub = database.get_recurring_subscription(sub_id)
        if sub and sub.get('status') in ('ACTIVE', 'PAST_DUE'):
            if int(sub.get('retry_count') or 0) == 0 and sub.get('status') == 'ACTIVE':
                recurring.handle_failed_charge(sub, reason=reason)


def handle_recurrent(data: dict) -> None:
    status = str(_field(data, 'Status', 'status') or '')
    sub_id = str(_field(data, 'Id', 'id') or '')
    account_id = str(_field(data, 'AccountId', 'accountId') or '')
    logger.info('CP Recurrent id=%s account=%s status=%s', sub_id, account_id, status)


def process_cloudpayments_request(request: Request, event: Optional[str] = None):
    """Process CP notification. Returns Flask response; code 0 acknowledges receipt."""
    try:
        logger.info(
            'CP webhook hit path=%s event=%s method=%s content_type=%s',
            request.path, event, request.method, request.content_type,
        )

        if request.method == 'GET':
            return jsonify({
                'status': 'ok',
                'message': 'CloudPayments webhook endpoint is reachable',
                'path': request.path,
                'cloudpayments_configured': cloudpayments_api.is_configured,
            })

        data, raw_body = parse_request_payload(request)
        content_hmac = request.headers.get('Content-HMAC', '') or request.headers.get('Content-Hmac', '')
        x_content_hmac = request.headers.get('X-Content-HMAC', '') or request.headers.get('X-Content-Hmac', '')

        logger.info(
            'CP webhook body_len=%s keys=%s hmac=%s',
            len(raw_body), list(data.keys())[:25], bool(content_hmac or x_content_hmac),
        )

        if cloudpayments_api.is_configured:
            if not cloudpayments_api.verify_webhook_hmac(raw_body, content_hmac, x_content_hmac):
                logger.error('CP webhook HMAC rejected — payment NOT processed')
                # Acknowledge to avoid endless retries, but do not apply funds
                return jsonify({'code': 0})

        event_name = (event or request.args.get('event') or '').lower()
        if not event_name:
            if _field(data, 'Interval', 'interval') and _field(data, 'Id', 'id') and _field(data, 'SuccessfulTransactionsNumber') is not None:
                event_name = 'recurrent'
            else:
                status = str(_field(data, 'Status', 'status') or '')
                if status in ('Declined',):
                    event_name = 'fail'
                elif status in ('Completed', 'Authorized', 'Paid'):
                    event_name = 'pay'
                elif _field(data, 'Reason', 'reason') and not status:
                    event_name = 'fail'
                else:
                    event_name = 'pay'

        logger.info('CP webhook event=%s', event_name)

        if event_name in ('pay', 'confirm'):
            handle_pay(data)
        elif event_name == 'fail':
            handle_fail(data)
        elif event_name == 'recurrent':
            handle_recurrent(data)
        elif event_name == 'check':
            return jsonify({'code': 0})
        else:
            logger.info('CP webhook ignored event=%s', event_name)

        return jsonify({'code': 0})
    except Exception as exc:
        logger.exception('CP webhook error: %s', exc)
        return jsonify({'code': 0})
