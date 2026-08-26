"""T-Bank (Tinkoff) Internet Acquiring client + webhook handlers."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs

import requests
from flask import Request, Response, jsonify

from src.api import recurring
from src.core import core
from src.database import database

logger = logging.getLogger(__name__)

TBANK_API_URL = os.getenv('TBANK_API_URL', 'https://securepay.tinkoff.ru').rstrip('/')
PROVIDER_NAME = 'TBank'


def _generate_token(payload: Dict[str, Any], password: str) -> str:
    """SHA-256 token: flat root fields + Password, sorted by key, values concatenated."""
    data: Dict[str, Any] = {}
    for key, value in payload.items():
        if key == 'Token':
            continue
        if isinstance(value, (dict, list)):
            continue
        if value is None:
            continue
        data[key] = value
    data['Password'] = password
    concatenated = ''.join(str(data[k]) for k in sorted(data.keys()))
    return hashlib.sha256(concatenated.encode('utf-8')).hexdigest()


class TBankAPI:
    def __init__(self):
        self.reload_from_env()

    def reload_from_env(self):
        self.terminal_key = (os.getenv('TBANK_TERMINAL_KEY') or '').strip()
        self.password = (os.getenv('TBANK_PASSWORD') or '').strip()
        self.api_url = (os.getenv('TBANK_API_URL') or 'https://securepay.tinkoff.ru').rstrip('/')
        self.notification_url = (os.getenv('TBANK_NOTIFICATION_URL') or '').strip()
        # Optional fiscalization
        self.taxation = (os.getenv('TBANK_TAXATION') or '').strip()  # e.g. usn_income
        self.vat = (os.getenv('TBANK_VAT') or 'none').strip()  # none | vat0 | vat10 | vat20 | ...

    @property
    def is_configured(self) -> bool:
        return bool(self.terminal_key and self.password)

    def _signed(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = dict(payload)
        body['TerminalKey'] = self.terminal_key
        body['Token'] = _generate_token(body, self.password)
        return body

    def verify_notification_token(self, data: dict) -> bool:
        if not self.password:
            return False
        received = str(data.get('Token') or '')
        if not received:
            return False
        expected = _generate_token(data, self.password)
        return hmac.compare_digest(expected, received)

    def _post(self, method: str, payload: Dict[str, Any], timeout: int = 40) -> Dict[str, Any]:
        if not self.is_configured:
            return {'ok': False, 'error': 'T-Bank is not configured'}
        url = f'{self.api_url}/v2/{method}'
        body = self._signed(payload)
        logger.info('TBank %s request body: %s', method, json.dumps(body, ensure_ascii=False))
        try:
            response = requests.post(url, json=body, timeout=timeout, headers={
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            })
            parsed: Optional[Dict[str, Any]] = None
            if response.content:
                try:
                    parsed = response.json()
                except Exception:
                    parsed = None
            if not isinstance(parsed, dict):
                logger.error('TBank %s unexpected: %s', method, (response.text or '')[:500])
                return {'ok': False, 'error': 'unexpected response', 'raw': response.text}
            success = bool(parsed.get('Success'))
            if not success:
                msg = parsed.get('Message') or parsed.get('Details') or f'{method} failed'
                logger.error('TBank %s failed: %s code=%s', method, msg, parsed.get('ErrorCode'))
                return {
                    'ok': False,
                    'error': msg,
                    'error_code': parsed.get('ErrorCode'),
                    'response': parsed,
                }
            return {'ok': True, 'response': parsed, **parsed}
        except requests.exceptions.RequestException as exc:
            logger.error('TBank %s error: %s', method, exc)
            return {'ok': False, 'error': str(exc)}

    def _receipt(self, amount_rub: float, description: str, email: Optional[str] = None) -> Optional[Dict[str, Any]]:
        if not self.taxation:
            return None
        amount_kop = int(round(float(amount_rub) * 100))
        receipt: Dict[str, Any] = {
            'Taxation': self.taxation,
            'Items': [{
                'Name': (description or 'Подписка VPN')[:128],
                'Price': amount_kop,
                'Quantity': 1,
                'Amount': amount_kop,
                'Tax': self.vat or 'none',
                'PaymentMethod': 'full_payment',
                'PaymentObject': 'service',
            }],
        }
        if email:
            receipt['Email'] = email
        return receipt

    def init_payment(
        self,
        *,
        amount: float,
        order_id: str,
        description: str,
        customer_key: str,
        success_url: Optional[str] = None,
        fail_url: Optional[str] = None,
        notification_url: Optional[str] = None,
        email: Optional[str] = None,
        recurrent: bool = True,
        data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        amount_kop = int(round(float(amount) * 100))
        if amount_kop <= 0:
            return {'ok': False, 'error': 'Invalid amount'}

        payload: Dict[str, Any] = {
            'Amount': amount_kop,
            'OrderId': str(order_id)[:36],
            'Description': (description or 'Оплата подписки')[:250],
            'CustomerKey': str(customer_key),
            'Language': 'ru',
            'PayType': 'O',
        }
        if recurrent:
            payload['Recurrent'] = 'Y'
        notify = (notification_url or self.notification_url or '').strip()
        if notify:
            payload['NotificationURL'] = notify
        if success_url:
            payload['SuccessURL'] = success_url
        if fail_url:
            payload['FailURL'] = fail_url
        if data:
            # T-Bank DATA values must be strings
            payload['DATA'] = {str(k): str(v) for k, v in data.items() if v is not None}

        receipt = self._receipt(amount, description, email=email)
        if receipt:
            payload['Receipt'] = receipt

        result = self._post('Init', payload)
        if not result.get('ok'):
            return result

        payment_url = result.get('PaymentURL') or (result.get('response') or {}).get('PaymentURL')
        payment_id = str(result.get('PaymentId') or (result.get('response') or {}).get('PaymentId') or '')
        if not payment_url:
            return {'ok': False, 'error': 'no payment url', 'response': result.get('response')}

        logger.info('TBank Init order=%s payment_id=%s amount_kop=%s', order_id, payment_id, amount_kop)
        return {
            'ok': True,
            'order_id': str(order_id),
            'payment_id': payment_id,
            'payment_url': str(payment_url),
            'amount': round(float(amount), 2),
            'response': result.get('response'),
        }

    def charge_by_rebill(
        self,
        *,
        amount: float,
        order_id: str,
        rebill_id: str,
        description: str,
        customer_key: str,
        email: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Recurring: Init → Charge with RebillId."""
        if not rebill_id:
            return {'ok': False, 'error': 'Missing RebillId'}

        init = self.init_payment(
            amount=amount,
            order_id=order_id,
            description=description,
            customer_key=customer_key,
            recurrent=False,
            email=email,
            data=data,
        )
        if not init.get('ok'):
            return init

        payment_id = init.get('payment_id')
        if not payment_id:
            return {'ok': False, 'error': 'Init returned no PaymentId'}

        charge = self._post('Charge', {
            'PaymentId': str(payment_id),
            'RebillId': str(rebill_id),
        })
        if not charge.get('ok'):
            return charge

        status = str(charge.get('Status') or (charge.get('response') or {}).get('Status') or '')
        paid = status in ('CONFIRMED', 'AUTHORIZED')
        logger.info(
            'TBank Charge order=%s payment_id=%s status=%s paid=%s',
            order_id, payment_id, status, paid,
        )
        return {
            'ok': paid,
            'success': bool(charge.get('Success', True)),
            'status': status,
            'transaction_id': str(payment_id),
            'payment_id': str(payment_id),
            'reason': charge.get('Message') or (charge.get('response') or {}).get('Message'),
            'response': charge.get('response'),
        }

    def cancel_payment(
        self,
        *,
        payment_id: str | int,
        amount: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Full or partial refund via Cancel."""
        payload: Dict[str, Any] = {'PaymentId': str(payment_id).strip()}
        if amount is not None:
            payload['Amount'] = int(round(float(amount) * 100))
        result = self._post('Cancel', payload)
        if not result.get('ok'):
            return result
        return {
            'ok': True,
            'success': True,
            'transaction_id': str(payment_id),
            'status': result.get('Status'),
            'response': result.get('response'),
        }

    def get_state(self, payment_id: str | int) -> Dict[str, Any]:
        return self._post('GetState', {'PaymentId': str(payment_id)})


tbank_api = TBankAPI()


# ── Shared helpers (payment fulfillment) ─────────────────────────────

def notify_admin_about_deposit(user: Dict, amount: float, method: str, provider: str):
    username = user.get('username', 'N/A') if user else 'N/A'
    telegram_id = (user or {}).get('telegram_id') or '—'
    email = (user or {}).get('email') or '—'
    message = (
        f'💰 <b>Пополнение баланса</b>\n\n'
        f'👤 Пользователь: @{username}\n'
        f'🆔 Telegram ID: {telegram_id}\n'
        f'📧 Email: {email}\n'
        f'💵 Сумма: {amount}₽\n'
        f'💳 Способ: {method}\n'
        f'🏦 Провайдер: {provider}'
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
        return {str(k): v for k, v in raw.items()}
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
            try:
                data = json.loads(text)
            except Exception:
                qs = parse_qs(text, keep_blank_values=True)
                data = {k: (v[0] if isinstance(v, list) and v else v) for k, v in qs.items()}
        except Exception:
            data = {}
    return data if isinstance(data, dict) else {}, raw_body


def _record_subscription_payment(
    user_id: int,
    amount: float,
    method_name: str,
    payment_id: str,
    is_trial: bool = False,
    days: int = 0,
) -> Optional[int]:
    trans_type = 'subscription'
    desc = f'Пробный период {days} дн. ({method_name})' if is_trial else f'Подписка {days} дн. ({method_name})'
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO transactions (user_id, type, amount, status, description,
                                      payment_method, payment_provider, payment_id, duration_days)
            VALUES (?, ?, ?, 'Success', ?, ?, ?, ?, ?)
            """,
            (user_id, trans_type, float(amount), desc, method_name, PROVIDER_NAME, str(payment_id), int(days)),
        )
        tx_id = cursor.lastrowid
        conn.commit()
        return int(tx_id) if tx_id else None
    except Exception as exc:
        logger.error('_record_subscription_payment error: %s', exc)
        return None
    finally:
        conn.close()


def handle_pay(data: dict) -> None:
    payment_id = str(_field(data, 'PaymentId', 'paymentId') or '')
    amount_raw = _field(data, 'Amount', 'amount')
    # T-Bank sends kopecks
    amount = float(amount_raw or 0) / 100.0 if amount_raw is not None else 0.0
    order_id = str(_field(data, 'OrderId', 'orderId') or '')
    rebill_id = str(_field(data, 'RebillId', 'rebillId') or '') or None
    pan = str(_field(data, 'Pan', 'pan') or '') or None
    card_id = str(_field(data, 'CardId', 'cardId') or '') or None
    data_json = _parse_data_json(_field(data, 'Data', 'DATA', 'data'))
    status = str(_field(data, 'Status', 'status') or '')

    logger.info(
        'TBank Pay start payment_id=%s order=%s amount=%s status=%s rebill=%s',
        payment_id, order_id, amount, status, bool(rebill_id),
    )

    if payment_id and database.transaction_exists_by_payment_id(payment_id, PROVIDER_NAME):
        logger.info('TBank Pay already processed payment_id=%s', payment_id)
        return

    kind = str(data_json.get('kind') or '')
    sub_id_from_data = str(data_json.get('subscription_id') or '')
    if kind == 'recurring_renewal' or order_id.startswith('renew_'):
        if payment_id and database.transaction_exists_by_payment_id(payment_id, PROVIDER_NAME):
            return
        sub = database.get_recurring_subscription(sub_id_from_data) if sub_id_from_data else None
        if not sub and order_id.startswith('renew_'):
            parts = order_id.split('_')
            if len(parts) >= 2:
                maybe = '_'.join(parts[1:-1]) if len(parts) > 2 else parts[1]
                sub = database.get_recurring_subscription(maybe) or database.get_recurring_subscription(
                    'rcp_' + parts[1] if not maybe.startswith('rcp_') else maybe
                )
        if sub and sub.get('status') in ('ACTIVE', 'PAST_DUE'):
            recurring.handle_successful_charge(sub, transaction_id=payment_id, amount=amount)
        return

    intent = database.get_payment_intent(order_id) if order_id else None
    user_id: Optional[int] = None
    if intent:
        user_id = int(intent['user_id'])
    elif str(data_json.get('user_id') or '').isdigit():
        user_id = int(data_json['user_id'])
    else:
        customer_key = str(_field(data, 'CustomerKey', 'customerKey') or '')
        if customer_key.isdigit():
            user_id = int(customer_key)

    if not user_id:
        logger.error('TBank Pay: cannot resolve user_id order=%s', order_id)
        return

    if amount <= 0 and intent:
        amount = float(intent.get('amount') or 0)
    if amount <= 0:
        logger.error('TBank Pay: invalid amount payment_id=%s', payment_id)
        return

    method_name = 'Карта'
    card_last4 = pan[-4:] if pan and len(pan) >= 4 else None

    saved_method_id = None
    if rebill_id:
        saved_method_id = recurring.save_card_token(
            user_id, rebill_id, card_last4, card_id or 'TBank',
            provider=PROVIDER_NAME,
        )

    if intent and intent.get('status') != 'paid':
        database.mark_payment_intent_paid(order_id, payment_id)
        is_trial = bool(int(intent.get('is_trial') or 0))
        intent_days = int(intent.get('days') or 30)

        tx_id = _record_subscription_payment(
            user_id=user_id,
            amount=amount,
            method_name=method_name,
            payment_id=payment_id or order_id,
            is_trial=is_trial,
            days=intent_days,
        )
        try:
            database.accrue_developer_share(
                float(amount),
                source_transaction_id=tx_id,
                note=f"Доля с {'триала' if is_trial else 'подписки'} {amount:.2f}₽ ({method_name})",
            )
        except Exception as exc:
            logger.error('Developer share accrual failed: %s', exc)

        try:
            ref_result = database.credit_referral_income(
                user_id,
                float(amount),
                payment_id=str(payment_id or order_id),
            )
            if ref_result:
                try:
                    core.send_notification_to_user(
                        ref_result['referrer_telegram_id'],
                        f'💰 <b>Реферальный доход!</b>\n\n'
                        f'Ваш реферал {"активировал пробный период" if is_trial else "оплатил подписку"}.\n'
                        f'Ваше вознаграждение: <b>{ref_result["income"]:.0f}₽</b>',
                    )
                except Exception:
                    pass
        except Exception as exc:
            logger.error('Referral income accrual failed: %s', exc)

        user = database.get_user_by_id(user_id)
        _sub_result = None
        if is_trial:
            TRIAL_TRAFFIC_BYTES = int(int(database.get_system_setting('trial_traffic_gb') or 10) * 1024 ** 3)
            TRIAL_DEVICES = int(database.get_system_setting('trial_devices_limit') or 1)
            _sub_result = core.create_user_and_subscription(
                telegram_id=user.get('telegram_id') if user else None,
                username=user.get('username', '') if user else '',
                days=intent_days,
                traffic_limit=TRIAL_TRAFFIC_BYTES,
                plan_type=str(intent.get('plan_type') or 'vpn_regular'),
                devices_limit=TRIAL_DEVICES,
                force_new=False,
                email=user.get('email') if user else None,
                existing_user_id=user_id,
            )
            if _sub_result:
                try:
                    conn_t = database.get_db_connection()
                    conn_t.execute('UPDATE users SET trial_used = 1, status = ? WHERE id = ?', ('Trial', user_id))
                    conn_t.commit()
                    conn_t.close()
                except Exception as _e:
                    logger.error('handle_pay: failed to set trial_used for user %s: %s', user_id, _e)
            else:
                logger.error('handle_pay: failed to create trial VPN key for user %s', user_id)
        else:
            is_family = str(intent.get('plan_type') or '').endswith('family')
            if is_family:
                _traffic_key = 'family_traffic_gb'
                _devices_key = 'family_devices_limit'
                _default_devices = 5
            else:
                _traffic_key = 'paid_traffic_gb'
                _devices_key = 'paid_devices_limit'
                _default_devices = 2
            PAID_TRAFFIC_BYTES = int(int(database.get_system_setting(_traffic_key) or 10240) * 1024 ** 3)
            PAID_DEVICES = int(database.get_system_setting(_devices_key) or _default_devices)
            _sub_result = core.create_user_and_subscription(
                telegram_id=user.get('telegram_id') if user else None,
                username=user.get('username', '') if user else '',
                days=intent_days,
                traffic_limit=PAID_TRAFFIC_BYTES,
                plan_type=str(intent.get('plan_type') or 'vpn_regular'),
                devices_limit=PAID_DEVICES,
                force_new=False,
                email=user.get('email') if user else None,
                existing_user_id=user_id,
            )
            if _sub_result:
                try:
                    conn_u = database.get_db_connection()
                    conn_u.execute("UPDATE users SET status = 'Active' WHERE id = ?", (user_id,))
                    conn_u.commit()
                    conn_u.close()
                except Exception as _e:
                    logger.error('handle_pay: failed to set user status for user %s: %s', user_id, _e)
            else:
                logger.error('handle_pay: failed to create paid VPN key for user %s', user_id)

        if user and user.get('telegram_id'):
            label = 'Пробный период' if is_trial else 'Подписка'
            if _sub_result:
                core.send_notification_to_user(
                    user['telegram_id'],
                    f'✅ Оплата прошла успешно!\n{label} на {intent_days} дн. активирована.\n💳 Списано: {amount:.0f}₽',
                )
            else:
                core.send_notification_to_user(
                    user['telegram_id'],
                    '⚠️ Оплата прошла, но возникла ошибка при активации подписки. Обратитесь в поддержку.',
                )
        notify_admin_about_deposit(user, amount, method_name, PROVIDER_NAME)

        if _sub_result and _sub_result.get('key_id') and not intent.get('vpn_key_id'):
            try:
                conn_ki = database.get_db_connection()
                conn_ki.execute(
                    'UPDATE payment_intents SET vpn_key_id = ? WHERE invoice_id = ?',
                    (_sub_result['key_id'], order_id),
                )
                conn_ki.commit()
                conn_ki.close()
            except Exception as _e:
                logger.error('handle_pay: failed to update vpn_key_id in intent: %s', _e)

        if rebill_id or saved_method_id:
            recurring.create_recurring_after_first_payment(
                user_id=user_id,
                amount=float(intent.get('amount') or amount),
                duration_days=intent_days,
                plan_type=str(intent.get('plan_type') or 'vpn_regular'),
                tariff_category=str(intent.get('tariff_category') or 'regular'),
                devices_limit=int(intent.get('devices_limit') or 2),
                action_type=str(intent.get('action_type') or 'wizard'),
                vpn_key_id=int(intent['vpn_key_id']) if intent.get('vpn_key_id') else (
                    int(_sub_result['key_id']) if _sub_result and _sub_result.get('key_id') else None
                ),
                card_token=rebill_id or None,
                saved_method_id=saved_method_id,
                is_trial=is_trial,
            )
        else:
            logger.warning(
                'TBank Pay: no RebillId for order=%s — recurring not created '
                '(включите рекуррентные платежи на терминале Т‑Банка)',
                order_id,
            )
    else:
        logger.warning(
            'TBank Pay: payment without unpaid intent order=%s user=%s amount=%s',
            order_id, user_id, amount,
        )

    logger.info('TBank Pay processed payment_id=%s user=%s amount=%s', payment_id, user_id, amount)


def handle_fail(data: dict) -> None:
    order_id = str(_field(data, 'OrderId', 'orderId') or '')
    data_json = _parse_data_json(_field(data, 'Data', 'DATA', 'data'))
    reason = str(_field(data, 'Message', 'message', 'ErrorCode') or '')
    sub_id = str(data_json.get('subscription_id') or '')

    logger.info('TBank Fail order=%s reason=%s sub=%s', order_id, reason, sub_id)

    if sub_id:
        sub = database.get_recurring_subscription(sub_id)
        if sub and sub.get('status') in ('ACTIVE', 'PAST_DUE'):
            if int(sub.get('retry_count') or 0) == 0 and sub.get('status') == 'ACTIVE':
                recurring.handle_failed_charge(sub, reason=reason)


def process_tbank_request(request: Request):
    """Process T-Bank notification. Must respond with plain OK."""
    try:
        logger.info(
            'TBank webhook hit path=%s method=%s content_type=%s',
            request.path, request.method, request.content_type,
        )

        if request.method == 'GET':
            return jsonify({
                'status': 'ok',
                'message': 'T-Bank webhook endpoint is reachable',
                'tbank_configured': tbank_api.is_configured,
            })

        data, _raw = parse_request_payload(request)
        logger.info('TBank webhook keys=%s status=%s', list(data.keys())[:25], data.get('Status'))

        if tbank_api.is_configured:
            if not tbank_api.verify_notification_token(data):
                logger.error('TBank webhook Token rejected — payment NOT processed')
                # Still acknowledge to avoid endless retries
                return Response('OK', status=200, mimetype='text/plain')

        status = str(_field(data, 'Status', 'status') or '').upper()
        success = str(_field(data, 'Success', 'success') or '').lower() in ('true', '1', 'yes')

        if status in ('CONFIRMED', 'AUTHORIZED') or (success and status not in ('REJECTED', 'CANCELED', 'REFUNDED', 'PARTIAL_REFUNDED', 'DEADLINE_EXPIRED')):
            if status in ('CONFIRMED', 'AUTHORIZED'):
                handle_pay(data)
        elif status in ('REJECTED', 'CANCELED', 'DEADLINE_EXPIRED', 'AUTH_FAIL'):
            handle_fail(data)
        elif status in ('REFUNDED', 'PARTIAL_REFUNDED'):
            logger.info('TBank refund notification payment_id=%s', _field(data, 'PaymentId'))
        else:
            logger.info('TBank webhook ignored status=%s', status)

        return Response('OK', status=200, mimetype='text/plain')
    except Exception as exc:
        logger.exception('TBank webhook error: %s', exc)
        return Response('OK', status=200, mimetype='text/plain')
