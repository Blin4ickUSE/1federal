"""Platega.io API client + webhook handlers.

Документация: https://docs.platega.io
Базовый URL:  https://app.platega.io/
Авторизация:  заголовки X-MerchantId + X-Secret

Поддерживаемые операции:
  - Создание СБП-подписки (paymentMethod=6, interval=3/4)
  - Получение / отмена подписки
  - Создание разового платежа (СБП QR, paymentMethod=2)
  - Проверка статуса транзакции
  - Отмена транзакции (возврат)
  - Обработка callback-вебхуков

Рекуррент полностью управляется Platega:
  - Никаких токенов карты, никакого планировщика на нашей стороне.
  - После создания подписки пользователь переходит на redirect,
    привязывает счёт СБП, дальше Platega списывает сама.
  - Мы получаем callbacks: по каждому списанию и по статусу подписки.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import requests
from flask import Request, Response, jsonify

from src.core import core
from src.database import database

logger = logging.getLogger(__name__)

PLATEGA_BASE_URL = 'https://app.platega.io'
PROVIDER_NAME = 'Platega'

# paymentMethod int-коды
PM_SBP_QR = 2          # разовый СБП QR (не используем — только подписки)
PM_SUBSCRIPTION = 6    # СБП-подписка (рекуррент)

# SubscriptionInterval
INTERVAL_MONTH = '3'   # 30 дней
INTERVAL_YEAR = '4'    # год


class PlategalAPI:
    def __init__(self):
        self.reload_from_env()

    def reload_from_env(self):
        self.merchant_id = (os.getenv('PLATEGA_MERCHANT_ID') or '').strip()
        self.secret = (os.getenv('PLATEGA_SECRET') or '').strip()
        self.base_url = (os.getenv('PLATEGA_API_URL') or PLATEGA_BASE_URL).rstrip('/')

    @property
    def is_configured(self) -> bool:
        return bool(self.merchant_id and self.secret)

    def _headers(self) -> Dict[str, str]:
        return {
            'X-MerchantId': self.merchant_id,
            'X-Secret': self.secret,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

    def verify_callback(self, request: Request) -> bool:
        """Проверяем что callback пришёл от Platega: заголовки X-MerchantId и X-Secret."""
        if not self.is_configured:
            logger.warning('Platega не настроен — пропускаем проверку callback')
            return False
        incoming_mid = (request.headers.get('X-MerchantId') or '').strip()
        incoming_secret = (request.headers.get('X-Secret') or '').strip()
        ok = (incoming_mid == self.merchant_id and incoming_secret == self.secret)
        if not ok:
            logger.error(
                'Platega callback: неверные заголовки X-MerchantId/X-Secret '
                '(получен MerchantId=%s)', incoming_mid
            )
        return ok

    def _post(self, path: str, payload: Dict[str, Any], timeout: int = 40) -> Dict[str, Any]:
        if not self.is_configured:
            return {'ok': False, 'error': 'Platega не настроен (PLATEGA_MERCHANT_ID / PLATEGA_SECRET)'}
        url = f'{self.base_url}/{path.lstrip("/")}'
        logger.info('Platega POST %s body=%s', path, payload)
        try:
            resp = requests.post(url, json=payload, headers=self._headers(), timeout=timeout)
            data = resp.json() if resp.content else {}
            if not isinstance(data, dict):
                logger.error('Platega %s unexpected response: %s', path, resp.text[:500])
                return {'ok': False, 'error': 'unexpected response', 'raw': resp.text}
            # Platega возвращает HTTP 200/201 при успехе; ошибки — 400/401/etc
            if resp.status_code >= 400:
                msg = data.get('message') or data.get('error') or f'HTTP {resp.status_code}'
                logger.error('Platega %s error: %s', path, msg)
                return {'ok': False, 'error': msg, 'response': data}
            return {'ok': True, 'response': data, **data}
        except requests.exceptions.RequestException as exc:
            logger.error('Platega %s request error: %s', path, exc)
            return {'ok': False, 'error': str(exc)}

    def _get(self, path: str, timeout: int = 20) -> Dict[str, Any]:
        if not self.is_configured:
            return {'ok': False, 'error': 'Platega не настроен'}
        url = f'{self.base_url}/{path.lstrip("/")}'
        try:
            resp = requests.get(url, headers=self._headers(), timeout=timeout)
            data = resp.json() if resp.content else {}
            if resp.status_code >= 400:
                msg = (data.get('message') or data.get('error') or f'HTTP {resp.status_code}') if isinstance(data, dict) else f'HTTP {resp.status_code}'
                return {'ok': False, 'error': msg}
            return {'ok': True, 'response': data if isinstance(data, dict) else {'data': data}}
        except requests.exceptions.RequestException as exc:
            logger.error('Platega GET %s error: %s', path, exc)
            return {'ok': False, 'error': str(exc)}

    # ─── Подписки ────────────────────────────────────────────────────────────

    def create_subscription(
        self,
        *,
        amount: float,
        interval: str,          # INTERVAL_MONTH = '3', INTERVAL_YEAR = '4'
        interval_count: int,    # 1
        description: str,
        return_url: Optional[str] = None,
        failed_url: Optional[str] = None,
        payload: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Создать СБП-подписку.

        Platega создаёт подписку, возвращает redirect — туда отправляем пользователя.
        После привязки счёта Platega автоматически списывает amount каждый период.
        На нашей стороне ничего планировать не нужно.

        interval:       '3' = месяц, '4' = год
        interval_count: 1 (один период)
        """
        amount_int = int(round(float(amount)))  # Platega принимает целые рубли
        if amount_int <= 0:
            return {'ok': False, 'error': 'Некорректная сумма'}

        body: Dict[str, Any] = {
            'paymentMethod': PM_SUBSCRIPTION,
            'paymentDetails': {
                'amount': amount_int,
                'currency': 'RUB',
                'interval': str(interval),
                'intervalCount': int(interval_count),
            },
            'description': (description or 'VPN подписка')[:255],
        }
        if return_url:
            body['return'] = return_url
        if failed_url:
            body['failedUrl'] = failed_url
        if payload:
            body['payload'] = str(payload)

        result = self._post('transaction/process', body)
        if not result.get('ok'):
            return result

        resp = result.get('response') or {}
        subscription_id = resp.get('transactionId') or ''
        redirect = resp.get('redirect') or ''

        if not redirect:
            return {'ok': False, 'error': 'Platega не вернула redirect URL', 'response': resp}

        logger.info('Platega subscription created id=%s redirect=%s', subscription_id, redirect[:60])
        return {
            'ok': True,
            'subscription_id': subscription_id,  # transactionId = subscriptionId в Platega
            'redirect': redirect,
            'status': resp.get('status', 'PENDING'),
        }

    def get_subscription(self, subscription_id: str) -> Dict[str, Any]:
        """Получить подписку по ID."""
        return self._get(f'transaction/subscription/{subscription_id}')

    def cancel_subscription(self, subscription_id: str) -> Dict[str, Any]:
        """Отменить подписку (остановить будущие списания)."""
        result = self._post(f'transaction/subscription/{subscription_id}/cancel', {})
        if result.get('ok'):
            logger.info('Platega subscription %s cancelled', subscription_id)
        return result

    # ─── Транзакции / возвраты ───────────────────────────────────────────────

    def get_transaction_status(self, transaction_id: str) -> Dict[str, Any]:
        """Проверить статус транзакции."""
        return self._get(f'transaction/{transaction_id}')

    def cancel_transaction(self, transaction_id: str) -> Dict[str, Any]:
        """Возврат средств по транзакции (отмена).

        Возвращает: {ok, accepted, manualControlRequired, message}
        Если manualControlRequired=True — нужно обращаться в поддержку Platega вручную.
        """
        if not self.is_configured:
            return {'ok': False, 'error': 'Platega не настроен'}
        url = f'{self.base_url}/transaction/{transaction_id}/cancel'
        try:
            resp = requests.post(
                url,
                headers={**self._headers(), 'accept': 'text/plain'},
                timeout=30,
            )
            data = resp.json() if resp.content else {}
            if not isinstance(data, dict):
                return {'ok': False, 'error': f'HTTP {resp.status_code}'}
            accepted = bool(data.get('accepted', False))
            manual = bool(data.get('manualControlRequired', False))
            msg = data.get('message') or ''
            logger.info(
                'Platega cancel tx=%s accepted=%s manual=%s msg=%s',
                transaction_id, accepted, manual, msg
            )
            if manual:
                return {
                    'ok': False,
                    'error': f'Возврат требует ручной обработки: {msg}',
                    'manual_required': True,
                    'response': data,
                }
            return {'ok': accepted, 'accepted': accepted, 'message': msg, 'response': data}
        except requests.exceptions.RequestException as exc:
            logger.error('Platega cancel tx=%s error: %s', transaction_id, exc)
            return {'ok': False, 'error': str(exc)}


platega_api = PlategalAPI()


# ─── Вспомогательные функции ─────────────────────────────────────────────────

def _field(data: dict, *names) -> Any:
    """Извлечь поле из dict по нескольким возможным именам (case-insensitive fallback)."""
    for name in names:
        if name in data and data[name] is not None and data[name] != '':
            return data[name]
    lower_map = {str(k).lower(): v for k, v in data.items()}
    for name in names:
        v = lower_map.get(str(name).lower())
        if v is not None and v != '':
            return v
    return None


def _notify_admin_payment(user: Optional[Dict], amount: float, description: str):
    username = (user or {}).get('username', 'N/A')
    telegram_id = (user or {}).get('telegram_id') or '—'
    core.send_notification_to_admin(
        f'💰 <b>Новый платёж (Platega)</b>\n\n'
        f'👤 @{username}\n🆔 {telegram_id}\n'
        f'💵 {amount:.0f}₽\n📋 {description}'
    )


def _record_transaction(
    user_id: int,
    amount: float,
    payment_id: str,
    description: str,
    duration_days: int,
    tx_type: str = 'subscription',
) -> Optional[int]:
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO transactions
                (user_id, type, amount, status, description,
                 payment_method, payment_provider, payment_id, duration_days)
            VALUES (?, ?, ?, 'Success', ?, 'СБП', ?, ?, ?)
            """,
            (user_id, tx_type, float(amount), description,
             PROVIDER_NAME, str(payment_id), int(duration_days)),
        )
        tx_id = cursor.lastrowid
        conn.commit()
        return int(tx_id) if tx_id else None
    except Exception as exc:
        logger.error('_record_transaction error: %s', exc)
        return None
    finally:
        conn.close()


# ─── Обработчики callback-событий ────────────────────────────────────────────

def _handle_subscription_charge(data: dict) -> None:
    """Callback по списанию подписки.

    Поля: Id (transaction_id), Amount, Currency, Status,
          SubscriptionId, NextChargeAt, Payload.

    CONFIRMED → продлеваем VPN.
    CANCELED  → помечаем PAST_DUE (Platega сама повторит попытку).
    """
    tx_id = str(_field(data, 'Id', 'id') or '')
    amount_raw = _field(data, 'Amount', 'amount') or 0
    amount = float(amount_raw)
    status = str(_field(data, 'Status', 'status') or '').upper()
    subscription_id = str(_field(data, 'SubscriptionId', 'subscriptionId') or '')
    next_charge_at = str(_field(data, 'NextChargeAt', 'nextChargeAt') or '') or None

    logger.info(
        'Platega charge callback tx=%s sub=%s amount=%s status=%s next=%s',
        tx_id, subscription_id, amount, status, next_charge_at
    )

    if not subscription_id:
        logger.error('Platega charge callback: нет SubscriptionId')
        return

    sub = database.get_recurring_subscription(subscription_id)
    if not sub:
        logger.error('Platega charge callback: подписка %s не найдена в БД', subscription_id)
        return

    if status == 'CONFIRMED':
        # Проверка дублей
        if tx_id and database.transaction_exists_by_payment_id(tx_id, PROVIDER_NAME):
            logger.info('Platega charge already processed tx=%s', tx_id)
            return

        user_id = int(sub['user_id'])
        days = int(sub.get('duration_days') or 30)
        vpn_key_id = int(sub.get('vpn_key_id') or 0)

        # Продлеваем ключ
        ok = _extend_vpn_key(user_id, vpn_key_id, days, amount, payment_id=tx_id)

        # Обновляем подписку
        database.update_recurring_subscription(
            subscription_id,
            status='ACTIVE',
            retry_count=0,
            fail_notified=0,
            last_charge_at=_utcnow_iso(),
            next_charge_at=next_charge_at,
        )

        if not ok:
            logger.error('Platega charge: VPN extend failed sub=%s tx=%s', subscription_id, tx_id)

        # Реферал
        try:
            if amount > 0 and tx_id:
                ref = database.credit_referral_income(user_id, amount, payment_id=tx_id)
                if ref:
                    core.send_notification_to_user(
                        ref['referrer_telegram_id'],
                        f'💰 <b>Реферальный доход!</b>\n\nВаш реферал продлил подписку.\n'
                        f'Ваше вознаграждение: <b>{ref["income"]:.0f}₽</b>',
                    )
        except Exception as exc:
            logger.error('Platega charge: referral error: %s', exc)

    elif status == 'CANCELED':
        # Platega сама управляет retry — просто помечаем PAST_DUE
        fail_notified = int(sub.get('fail_notified') or 0)
        user_id = int(sub['user_id'])
        if fail_notified == 0:
            user = database.get_user_by_id(user_id)
            if user:
                core.send_notification_to_user(
                    user['telegram_id'],
                    '❌ <b>Не удалось списать оплату подписки</b>\n\n'
                    'Проверьте баланс счёта СБП — мы повторим попытку автоматически.\n'
                    'Или оплатите вручную в разделе «Подписка».',
                )
            fail_notified = 1
        database.update_recurring_subscription(
            subscription_id,
            status='PAST_DUE',
            fail_notified=fail_notified,
            next_charge_at=next_charge_at,  # может быть null если Platega сдалась
        )
        logger.info('Platega charge CANCELED sub=%s — PAST_DUE', subscription_id)
    else:
        logger.info('Platega charge: unknown status=%s sub=%s', status, subscription_id)


def _handle_subscription_status(data: dict) -> None:
    """Callback по смене статуса подписки.

    Поля: Id (=SubscriptionId), Status (SUBSCRIPTION_ACTIVATED / PAST_DUE /
          CANCELLED / FAILED), SubscriptionId, NextChargeAt.
    """
    subscription_id = str(_field(data, 'Id', 'id', 'SubscriptionId', 'subscriptionId') or '')
    status = str(_field(data, 'Status', 'status') or '').upper()
    next_charge_at = str(_field(data, 'NextChargeAt', 'nextChargeAt') or '') or None

    logger.info('Platega sub status callback sub=%s status=%s', subscription_id, status)

    if not subscription_id:
        logger.error('Platega sub status: нет SubscriptionId')
        return

    sub = database.get_recurring_subscription(subscription_id)
    if not sub:
        logger.error('Platega sub status: подписка %s не найдена', subscription_id)
        return

    if status == 'SUBSCRIPTION_ACTIVATED':
        database.update_recurring_subscription(
            subscription_id,
            status='ACTIVE',
            retry_count=0,
            fail_notified=0,
            next_charge_at=next_charge_at,
        )
        logger.info('Platega sub %s ACTIVATED, first charge at %s', subscription_id, next_charge_at)

    elif status == 'SUBSCRIPTION_PAST_DUE':
        database.update_recurring_subscription(subscription_id, status='PAST_DUE')

    elif status in ('SUBSCRIPTION_CANCELLED', 'SUBSCRIPTION_FAILED'):
        database.update_recurring_subscription(subscription_id, status='CANCELLED')
        user_id = int(sub['user_id'])
        user = database.get_user_by_id(user_id)
        if user:
            reason = 'отменена' if status == 'SUBSCRIPTION_CANCELLED' else 'не удалась привязка счёта'
            core.send_notification_to_user(
                user['telegram_id'],
                f'⚠️ <b>Подписка {reason}</b>\n\n'
                'Оформите новую подписку в разделе «Подписка».',
            )
    else:
        logger.info('Platega sub status: unknown=%s', status)


def _handle_regular_payment(data: dict) -> None:
    """Callback по обычному (разовому) платежу.

    Поля: id, amount, currency, status (CONFIRMED/CANCELED/CHARGEBACKED), payload.
    payload содержит invoice_id переданный при создании транзакции.
    """
    tx_id = str(_field(data, 'id', 'Id') or '')
    amount = float(_field(data, 'amount', 'Amount') or 0)
    status = str(_field(data, 'status', 'Status') or '').upper()
    payload_str = str(_field(data, 'payload', 'Payload') or '')

    logger.info('Platega payment callback tx=%s amount=%s status=%s payload=%s',
                tx_id, amount, status, payload_str[:100])

    if status not in ('CONFIRMED',):
        logger.info('Platega payment: ignored status=%s', status)
        return

    if not payload_str:
        logger.error('Platega payment: нет payload (invoice_id) tx=%s', tx_id)
        return

    invoice_id = payload_str.strip()
    intent = database.get_payment_intent(invoice_id) if invoice_id else None
    if not intent:
        logger.error('Platega payment: intent не найден invoice=%s', invoice_id)
        return

    if intent.get('status') == 'paid':
        logger.info('Platega payment: already processed invoice=%s', invoice_id)
        return

    if tx_id and database.transaction_exists_by_payment_id(tx_id, PROVIDER_NAME):
        logger.info('Platega payment: duplicate tx=%s', tx_id)
        return

    user_id = int(intent['user_id'])
    is_trial = bool(int(intent.get('is_trial') or 0))
    intent_days = int(intent.get('days') or 30)
    plan_type = str(intent.get('plan_type') or 'vpn_regular')

    if amount <= 0:
        amount = float(intent.get('amount') or 0)

    database.mark_payment_intent_paid(invoice_id, tx_id)

    desc = f'Подписка {intent_days} дн. (Platega)'
    tx_id_db = _record_transaction(user_id, amount, tx_id, desc, intent_days)

    try:
        database.accrue_developer_share(
            amount,
            source_transaction_id=tx_id_db,
            note=f'Доля с подписки {amount:.2f}₽',
        )
    except Exception as exc:
        logger.error('Platega payment: developer share error: %s', exc)

    user = database.get_user_by_id(user_id)
    PAID_TRAFFIC = int(10 * 1024 ** 4)  # 10 TB
    devices = int(intent.get('devices_limit') or 2)
    result = core.create_user_and_subscription(
        telegram_id=user.get('telegram_id') if user else None,
        username=user.get('username', '') if user else '',
        days=intent_days,
        traffic_limit=PAID_TRAFFIC,
        plan_type=plan_type,
        devices_limit=devices,
        force_new=False,
        email=user.get('email') if user else None,
        existing_user_id=user_id,
    )

    if result:
        conn = database.get_db_connection()
        conn.execute("UPDATE users SET status = 'Active' WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()
        if user:
            core.send_notification_to_user(
                user['telegram_id'],
                f'✅ Оплата прошла!\nПодписка на {intent_days} дн. активирована.\n💳 Списано: {amount:.0f}₽',
            )
        _notify_admin_payment(user, amount, desc)
    else:
        logger.error('Platega payment: VPN key creation failed user=%s', user_id)
        if user:
            core.send_notification_to_user(
                user['telegram_id'],
                '⚠️ Оплата прошла, но возникла ошибка активации. Обратитесь в поддержку.',
            )

    try:
        ref = database.credit_referral_income(user_id, amount, payment_id=tx_id)
        if ref:
            core.send_notification_to_user(
                ref['referrer_telegram_id'],
                f'💰 <b>Реферальный доход!</b>\n\n'
                f'Ваш реферал оплатил подписку.\n'
                f'Ваше вознаграждение: <b>{ref["income"]:.0f}₽</b>',
            )
    except Exception as exc:
        logger.error('Platega payment: referral error: %s', exc)


def _is_subscription_callback(data: dict) -> bool:
    """Определяем тип callback-а: подписочное списание или статус подписки."""
    return bool(_field(data, 'SubscriptionId', 'subscriptionId'))


def _is_subscription_status_callback(data: dict) -> bool:
    """Callback по смене статуса подписки — Status начинается с SUBSCRIPTION_."""
    status = str(_field(data, 'Status', 'status') or '')
    return status.upper().startswith('SUBSCRIPTION_')


# ─── Вспомогательные функции продления VPN ───────────────────────────────────

def _utcnow_iso() -> str:
    from datetime import datetime
    return datetime.utcnow().replace(microsecond=0).isoformat()


def _extend_vpn_key(
    user_id: int,
    key_id: int,
    days: int,
    amount: float,
    payment_id: Optional[str] = None,
) -> bool:
    """Продлить VPN-ключ пользователя на days дней."""
    from datetime import datetime, timedelta
    from src.api import remnawave

    if payment_id and database.transaction_exists_by_payment_id(str(payment_id), PROVIDER_NAME):
        logger.info('_extend_vpn_key: duplicate payment_id=%s', payment_id)
        return True

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT id, key_uuid, expiry_date, devices_limit FROM vpn_keys WHERE id = ? AND user_id = ?",
            (key_id, user_id),
        )
        row = cursor.fetchone()
        if not row:
            # Fallback — берём любой активный ключ
            cursor.execute(
                "SELECT id, key_uuid, expiry_date, devices_limit FROM vpn_keys "
                "WHERE user_id = ? AND status = 'Active' ORDER BY id DESC LIMIT 1",
                (user_id,),
            )
            row = cursor.fetchone()
        if not row:
            logger.error('_extend_vpn_key: ключ не найден user=%s', user_id)
            return False

        real_key_id = int(row['id'])
        key_uuid = row['key_uuid']
        current_expiry = row['expiry_date']

        if current_expiry:
            try:
                exp_dt = datetime.fromisoformat(str(current_expiry).replace('Z', '').replace('+00:00', ''))
            except Exception:
                exp_dt = datetime.now()
            new_expiry = (exp_dt if exp_dt > datetime.now() else datetime.now()) + timedelta(days=days)
        else:
            new_expiry = datetime.now() + timedelta(days=days)

        if key_uuid:
            try:
                remnawave.remnawave_api.update_user_sync(
                    uuid=key_uuid,
                    expire_at=new_expiry,
                    status=remnawave.UserStatus.ACTIVE,
                )
            except Exception as exc:
                logger.error('_extend_vpn_key: remnawave error: %s', exc)
                return False

        cursor.execute(
            "UPDATE vpn_keys SET status = 'Active', expiry_date = ? WHERE id = ?",
            (new_expiry.isoformat(), real_key_id),
        )
        cursor.execute(
            """INSERT INTO transactions
               (user_id, type, amount, status, description, payment_method,
                payment_provider, payment_id, duration_days)
               VALUES (?, 'subscription_extend', ?, 'Success', ?, 'СБП', ?, ?, ?)""",
            (user_id, -float(amount),
             f'Автопродление подписки ({days} дн.)',
             'СБП', str(payment_id) if payment_id else None, int(days)),
        )
        tx_id = cursor.lastrowid
        conn.commit()

        try:
            database.accrue_developer_share(
                float(amount),
                source_transaction_id=int(tx_id) if tx_id else None,
                note=f'Доля с автопродления {amount:.2f}₽',
            )
        except Exception as exc:
            logger.error('_extend_vpn_key: developer share error: %s', exc)

        user = database.get_user_by_id(user_id)
        if user:
            core.send_notification_to_user(
                user['telegram_id'],
                f'✅ Подписка продлена на {days} дн.\n'
                f'📅 До: {new_expiry.strftime("%d.%m.%Y")}\n'
                f'💳 Списано: {amount:.0f}₽',
            )
        return True
    except Exception as exc:
        logger.error('_extend_vpn_key error: %s', exc)
        return False
    finally:
        conn.close()


# ─── Главный обработчик webhook ──────────────────────────────────────────────

def process_platega_request(request: Request) -> Response:
    """Принять и обработать callback от Platega.

    Один URL в настройках Platega (Настройки → Callback URLs).
    Platega шлёт заголовки X-MerchantId + X-Secret для верификации.
    Ожидаемый ответ: HTTP 200.
    """
    try:
        logger.info(
            'Platega webhook: method=%s content_type=%s',
            request.method, request.content_type,
        )

        if request.method == 'GET':
            return jsonify({
                'status': 'ok',
                'message': 'Platega webhook endpoint is reachable',
                'configured': platega_api.is_configured,
            })

        # Верификация
        if platega_api.is_configured:
            if not platega_api.verify_callback(request):
                logger.error('Platega webhook: верификация не прошла — игнорируем')
                # Отвечаем 200 чтобы Platega не повторяла бесконечно
                return Response('OK', status=200)

        data = request.get_json(silent=True) or {}
        logger.info('Platega webhook data keys=%s status=%s',
                    list(data.keys())[:15], _field(data, 'Status', 'status'))

        # Определяем тип callback-а
        if _is_subscription_status_callback(data):
            # Смена статуса подписки: SUBSCRIPTION_ACTIVATED / PAST_DUE / CANCELLED / FAILED
            _handle_subscription_status(data)
        elif _is_subscription_callback(data):
            # Списание по подписке (есть SubscriptionId)
            _handle_subscription_charge(data)
        else:
            # Обычный разовый платёж
            _handle_regular_payment(data)

        return Response('OK', status=200)

    except Exception as exc:
        logger.exception('Platega webhook error: %s', exc)
        return Response('OK', status=200)
