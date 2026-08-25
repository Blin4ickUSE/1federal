"""Self-managed CloudPayments recurring charges + VPN renewals."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from src.api import cloudpayments, remnawave
from src.core import core
from src.database import database

logger = logging.getLogger(__name__)

# Схема попыток (в минутах, отрицательное = до конца подписки):
# -24ч, -12ч, -1ч, 0ч (момент окончания), +1ч, +4ч, +8ч, +12ч, +24ч
# next_retry_at считает задержку относительно текущего момента (от предыдущей неудачи)
RETRY_DELAYS_MINUTES = (60, 180, 240, 240, 720)  # +1ч, +4ч (3ч от +1ч), +8ч (4ч от +4ч), +12ч (4ч от +8ч), +24ч (12ч от +12ч)

# Расписание попыток относительно момента окончания подписки (в часах)
# Первые 4 попытки — ДО/в момент окончания (запускаются планировщиком заранее)
# Попытки 5-9 — ПОСЛЕ окончания (через 1ч, 4ч, 8ч, 12ч, 24ч)
PRE_EXPIRY_SCHEDULE_HOURS = [-24, -12, -1, 0]   # относительно expiry_date
POST_EXPIRY_DELAYS_MINUTES = [60, 240, 480, 720, 1440]  # 1ч, 4ч, 8ч, 12ч, 24ч после предыдущей неудачи

# Дефолты используются только если trial_tariff не настроен в панели
MONTHLY_REGULAR_PRICE = 399.0
MONTHLY_REGULAR_DAYS = 30
MONTHLY_REGULAR_DEVICES = 2


def _get_trial_conversion_params() -> tuple:
    """Вернуть (price, days, devices, plan_type, tariff_category) для конвертации триала.
    Берётся из настроек панели (system_settings.trial_tariff_id).
    """
    tariff = database.get_trial_tariff()
    if tariff:
        is_family = tariff['plan_type'] == 'vpn_family'
        devices_key = 'family_devices_limit' if is_family else 'paid_devices_limit'
        devices = int(database.get_system_setting(devices_key) or (5 if is_family else 2))
        return (
            float(tariff['price']),
            int(tariff['duration_days']),
            devices,
            tariff['plan_type'],
            'family' if is_family else 'regular',
        )
    # Фолбэк на хардкод если тариф не настроен
    return (MONTHLY_REGULAR_PRICE, MONTHLY_REGULAR_DAYS, MONTHLY_REGULAR_DEVICES, 'vpn_regular', 'regular')


def _now() -> datetime:
    return datetime.utcnow()


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


def next_retry_at(retry_count: int, from_dt: Optional[datetime] = None) -> Optional[datetime]:
    """retry_count — сколько неудач уже было после момента окончания подписки (0 = первая постэкспайри попытка).
    Планируется следующая постэкспайри попытка: +1ч, +4ч, +8ч, +12ч, +24ч.
    """
    if retry_count < 0 or retry_count >= len(POST_EXPIRY_DELAYS_MINUTES):
        return None
    base = from_dt or _now()
    return base + timedelta(minutes=POST_EXPIRY_DELAYS_MINUTES[retry_count])


def schedule_pre_expiry_attempts(expiry_dt: datetime) -> list[str]:
    """Вернуть список ISO-строк для попыток за 24ч, 12ч, 1ч до и в момент окончания подписки."""
    return [
        _iso(expiry_dt + timedelta(hours=h))
        for h in PRE_EXPIRY_SCHEDULE_HOURS
    ]


def schedule_next_period(duration_days: int, from_dt: Optional[datetime] = None) -> str:
    base = from_dt or _now()
    return _iso(base + timedelta(days=int(duration_days)))


def save_card_token(
    user_id: int,
    token: str,
    card_last4: Optional[str] = None,
    card_brand: Optional[str] = None,
) -> Optional[int]:
    if not token:
        return None
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO saved_payment_methods (
                user_id, payment_provider, payment_method_id, payment_method_type,
                card_last4, card_brand, is_active
            ) VALUES (?, 'CloudPayments', ?, 'card', ?, ?, 1)
            ON CONFLICT(user_id, payment_provider, payment_method_id)
            DO UPDATE SET
                is_active = 1,
                card_last4 = COALESCE(excluded.card_last4, saved_payment_methods.card_last4),
                card_brand = COALESCE(excluded.card_brand, saved_payment_methods.card_brand),
                updated_at = CURRENT_TIMESTAMP
            """,
            (user_id, token, card_last4, card_brand),
        )
        conn.commit()
        cursor.execute(
            """
            SELECT id FROM saved_payment_methods
            WHERE user_id = ? AND payment_provider = 'CloudPayments' AND payment_method_id = ?
            """,
            (user_id, token),
        )
        row = cursor.fetchone()
        return int(row['id']) if row else None
    except Exception as exc:
        logger.error('save_card_token error: %s', exc)
        return None
    finally:
        conn.close()


def deactivate_card_and_cancel_recurring(user_id: int, method_id: int) -> bool:
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT payment_method_id FROM saved_payment_methods
            WHERE id = ? AND user_id = ?
            """,
            (method_id, user_id),
        )
        row = cursor.fetchone()
        if not row:
            return False
        token = row['payment_method_id']
        cursor.execute(
            """
            UPDATE saved_payment_methods
            SET is_active = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (method_id, user_id),
        )
        cursor.execute(
            """
            UPDATE recurring_subscriptions
            SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
              AND status IN ('PENDING', 'ACTIVE', 'PAST_DUE')
              AND (saved_method_id = ? OR card_token = ?)
            """,
            (user_id, method_id, token),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def extend_vpn_key(
    user_id: int,
    key_id: int,
    days: int,
    amount: float,
    *,
    devices_limit: Optional[int] = None,
    traffic_limit: Optional[int] = None,
    notify: bool = True,
    payment_method: str = 'CloudPayments',
    payment_id: Optional[str] = None,
) -> bool:
    if payment_id and database.transaction_exists_by_payment_id(str(payment_id), 'CloudPayments'):
        logger.info('extend_vpn_key skip duplicate payment_id=%s', payment_id)
        return True

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'SELECT id, key_uuid, expiry_date, devices_limit FROM vpn_keys WHERE id = ? AND user_id = ?',
            (key_id, user_id),
        )
        key_row = cursor.fetchone()
        if not key_row:
            cursor.execute(
                """
                SELECT id, key_uuid, expiry_date, devices_limit FROM vpn_keys
                WHERE user_id = ? AND status = 'Active'
                ORDER BY id DESC LIMIT 1
                """,
                (user_id,),
            )
            key_row = cursor.fetchone()
        if not key_row:
            logger.warning('extend_vpn_key: no vpn key for user %s', user_id)
            return False

        key_id = int(key_row['id'])
        key_uuid = key_row['key_uuid']
        current_expiry = key_row['expiry_date']
        new_devices = int(devices_limit) if devices_limit is not None else None

        if current_expiry:
            try:
                expiry_dt = datetime.fromisoformat(
                    str(current_expiry).replace('Z', '+00:00').replace('+00:00', '')
                )
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
                rw_kwargs = dict(
                    uuid=key_uuid,
                    expire_at=new_expiry,
                    status=remnawave.UserStatus.ACTIVE,
                    hwid_device_limit=new_devices,
                )
                if traffic_limit is not None:
                    rw_kwargs['traffic_limit_bytes'] = int(traffic_limit)
                remnawave.remnawave_api.update_user_sync(**rw_kwargs)
            except Exception as e:
                logger.error('extend_vpn_key Remnawave update failed: %s', e)
                return False

        new_expiry_str = new_expiry.isoformat()
        if new_devices is not None and traffic_limit is not None:
            cursor.execute(
                "UPDATE vpn_keys SET status = 'Active', expiry_date = ?, devices_limit = ?, traffic_limit = ? WHERE id = ?",
                (new_expiry_str, new_devices, int(traffic_limit), key_id),
            )
        elif new_devices is not None:
            cursor.execute(
                "UPDATE vpn_keys SET status = 'Active', expiry_date = ?, devices_limit = ? WHERE id = ?",
                (new_expiry_str, new_devices, key_id),
            )
        elif traffic_limit is not None:
            cursor.execute(
                "UPDATE vpn_keys SET status = 'Active', expiry_date = ?, traffic_limit = ? WHERE id = ?",
                (new_expiry_str, int(traffic_limit), key_id),
            )
        else:
            cursor.execute(
                "UPDATE vpn_keys SET status = 'Active', expiry_date = ? WHERE id = ?",
                (new_expiry_str, key_id),
            )
        cursor.execute(
            """
            INSERT INTO transactions (
                user_id, type, amount, status, description, payment_method,
                payment_provider, payment_id, duration_days
            ) VALUES (?, 'subscription_extend', ?, 'Success', ?, ?, 'CloudPayments', ?, ?)
            """,
            (
                user_id, -float(amount), f'Автопродление подписки ({days} дн.)',
                payment_method, str(payment_id) if payment_id else None, int(days),
            ),
        )
        tx_id = cursor.lastrowid
        conn.commit()
        database.link_recurring_subscription_to_vpn_key(user_id, int(key_id))
        try:
            paid = float(amount or 0)
            if paid > 0:
                database.accrue_developer_share(
                    paid,
                    source_transaction_id=int(tx_id) if tx_id else None,
                    note=f'Доля с автопродления {paid:.2f}₽',
                )
        except Exception as exc:
            logger.error('Developer share accrual on extend failed: %s', exc)

        if notify:
            user = database.get_user_by_id(user_id)
            if user:
                core.send_notification_to_user(
                    user['telegram_id'],
                    f'✅ Оплата прошла успешно.\n'
                    f'Подписка продлена на {days} дн.\n'
                    f'📅 Новая дата окончания: {new_expiry.strftime("%d.%m.%Y")}\n'
                    f'💳 Списано: {amount:.0f}₽',
                )
        return True
    except Exception as e:
        logger.error('extend_vpn_key error: %s', e)
        return False
    finally:
        conn.close()


def create_recurring_after_first_payment(
    *,
    user_id: int,
    amount: float,
    duration_days: int,
    plan_type: str,
    tariff_category: str,
    devices_limit: int,
    action_type: str,
    vpn_key_id: Optional[int],
    card_token: Optional[str],
    saved_method_id: Optional[int],
    is_trial: bool,
) -> Optional[str]:
    """Создать план автопродления после успешного установочного платежа."""
    sub_id = f'rcp_{uuid.uuid4().hex[:24]}'

    if is_trial:
        # После триала списываем по тарифу из настроек панели
        charge_amount, renew_days, renew_devices, renew_plan, renew_category = _get_trial_conversion_params()
        converts = 1
        # Первая попытка списания — за 24ч до конца триального периода
        expiry_dt = _now() + timedelta(days=7)
        next_at = _iso(expiry_dt + timedelta(hours=PRE_EXPIRY_SCHEDULE_HOURS[0]))
    else:
        charge_amount = float(amount)
        renew_days = int(duration_days)
        renew_devices = int(devices_limit)
        renew_plan = plan_type
        renew_category = tariff_category
        converts = 0
        # Первая попытка — за 24ч до конца текущего периода
        expiry_dt = _now() + timedelta(days=renew_days)
        next_at = _iso(expiry_dt + timedelta(hours=PRE_EXPIRY_SCHEDULE_HOURS[0]))

    ok = database.create_recurring_subscription(
        user_id=user_id,
        subscription_id=sub_id,
        amount=charge_amount,
        duration_days=renew_days,
        plan_type=renew_plan,
        tariff_category=renew_category,
        devices_limit=renew_devices,
        action_type=action_type,
        vpn_key_id=vpn_key_id,
        card_token=card_token,
        saved_method_id=saved_method_id,
        next_charge_at=next_at,
        last_charge_at=_iso(_now()),
        converts_from_trial=converts,
        status='ACTIVE',
    )
    return sub_id if ok else None


def handle_failed_charge(sub: Dict[str, Any], reason: str = '', is_pre_expiry: bool = False) -> None:
    """Обрабатывает неудачное списание.

    Если это до-/в-момент-истечения попытка (is_pre_expiry=True), retry_count не увеличивается —
    планировщик сам выставит следующую pre-expiry попытку по расписанию.
    После истечения подписки: retry_count идёт по POST_EXPIRY_DELAYS_MINUTES.
    """
    user_id = int(sub['user_id'])
    sub_id = sub['subscription_id']
    retry_count = int(sub.get('retry_count') or 0)
    fail_notified = int(sub.get('fail_notified') or 0)

    user = database.get_user_by_id(user_id)
    if user and fail_notified == 0:
        core.send_notification_to_user(
            user['telegram_id'],
            '❌ <b>Не удалось произвести оплату</b>\n\n'
            'Автоматическое списание за подписку не прошло.\n'
            'Проверьте баланс карты — мы повторим попытку позже.\n'
            'Вы также можете оплатить вручную в разделе «Подписка».',
        )
        fail_notified = 1

    if is_pre_expiry:
        # Планировщик сам выставляет следующую pre-expiry точку — просто обновляем notified
        database.update_recurring_subscription(
            sub_id,
            status='PAST_DUE',
            fail_notified=fail_notified,
        )
        logger.info('Recurring %s pre-expiry fail (%s), scheduler handles next attempt', sub_id, reason)
        return

    # Пост-истечение: перебираем POST_EXPIRY_DELAYS_MINUTES
    next_at = next_retry_at(retry_count)
    if next_at is None:
        database.update_recurring_subscription(
            sub_id,
            status='PAST_DUE',
            retry_count=retry_count,
            fail_notified=fail_notified,
            next_charge_at=None,
        )
        logger.info('Recurring %s exhausted all retries, PAST_DUE (%s)', sub_id, reason)
        return

    database.update_recurring_subscription(
        sub_id,
        status='PAST_DUE',
        retry_count=retry_count + 1,
        fail_notified=fail_notified,
        next_charge_at=_iso(next_at),
    )
    logger.info(
        'Recurring %s post-expiry fail #%s, next retry at %s (%s)',
        sub_id, retry_count + 1, _iso(next_at), reason,
    )


def handle_successful_charge(
    sub: Dict[str, Any],
    *,
    transaction_id: Optional[str] = None,
    amount: Optional[float] = None,
) -> bool:
    user_id = int(sub['user_id'])
    sub_id = sub['subscription_id']
    charge_amount = float(amount if amount is not None else sub.get('amount') or 0)
    days = int(sub.get('duration_days') or 30)
    devices = int(sub.get('devices_limit') or 2)
    converts = int(sub.get('converts_from_trial') or 0)
    vpn_key_id = int(sub.get('vpn_key_id') or 0)

    if converts:
        # Берём параметры конвертации из настроек панели
        charge_amount, days, devices, plan_type_conv, cat_conv = _get_trial_conversion_params()
        sub['plan_type'] = plan_type_conv
        sub['tariff_category'] = cat_conv

    # При конвертации триала → платная: трафик 10 ТБ, 2 устройства
    PAID_TRAFFIC_BYTES = int(10 * 1024 ** 4)  # 10 TB
    ok = extend_vpn_key(
        user_id,
        vpn_key_id,
        days,
        charge_amount,
        devices_limit=devices if converts else None,
        traffic_limit=PAID_TRAFFIC_BYTES if converts else None,
        notify=True,
        payment_id=transaction_id,
    )
    # Следующая попытка — за 24ч до конца нового периода
    # ВАЖНО: обновляем next_charge_at СРАЗУ после успешного списания,
    # даже если extend_vpn_key упал — иначе подписка будет снова списываться каждую минуту
    new_expiry_dt = _now() + timedelta(days=days)
    next_charge = _iso(new_expiry_dt + timedelta(hours=PRE_EXPIRY_SCHEDULE_HOURS[0]))
    database.update_recurring_subscription(
        sub_id,
        status='ACTIVE',
        retry_count=0,
        fail_notified=0,
        converts_from_trial=0,
        last_charge_at=_iso(_now()),
        next_charge_at=next_charge,
        amount=charge_amount if converts else None,
        duration_days=days if converts else None,
        plan_type=sub.get('plan_type') if converts else None,
        tariff_category=sub.get('tariff_category') if converts else None,
        devices_limit=devices if converts else None,
    )

    if not ok:
        logger.error('Successful charge but VPN extend failed sub=%s — next_charge_at still updated to prevent loop', sub_id)
        return False

    # Реферальный доход — начисляем здесь, используя transaction_id как dedup ключ
    # (transaction_id уникален per CloudPayments платёж)
    try:
        if charge_amount > 0 and transaction_id:
            ref_result = database.credit_referral_income(
                user_id, charge_amount,
                payment_id=str(transaction_id),
            )
            if ref_result:
                logger.info('Referral income %s₽ → referrer_id=%s (recurring)', ref_result['income'], ref_result['referrer_id'])
                try:
                    core.send_notification_to_user(
                        ref_result['referrer_telegram_id'],
                        f'💰 <b>Реферальный доход!</b>\n\nВаш реферал продлил подписку.\n'
                        f'Ваше вознаграждение: <b>{ref_result["income"]:.0f}₽</b>',
                    )
                except Exception:
                    pass
    except Exception as exc:
        logger.error('Referral income in handle_successful_charge failed: %s', exc)

    if transaction_id:
        logger.info('Recurring %s charged ok tx=%s', sub_id, transaction_id)
    return True


def process_due_charges(limit: int = 40) -> int:
    """Списать все подписки с next_charge_at <= now. Возвращает число попыток."""
    due = database.get_due_recurring_subscriptions(limit=limit)
    processed = 0
    for sub in due:
        processed += 1
        try:
            _charge_one(sub)
        except Exception as exc:
            logger.error('process_due_charges error sub=%s: %s', sub.get('subscription_id'), exc)
    return processed


def _charge_one(sub: Dict[str, Any]) -> None:
    sub_id = sub['subscription_id']
    user_id = int(sub['user_id'])

    # Захватываем слот на 30 минут — если что-то пойдёт не так,
    # handle_successful_charge обновит next_charge_at на ~30 дней вперёд
    database.update_recurring_subscription(
        sub_id,
        next_charge_at=_iso(_now() + timedelta(minutes=30)),
    )

    token = (sub.get('card_token') or '').strip()
    if not token and sub.get('saved_method_id'):
        method = database.get_saved_payment_method(int(sub['saved_method_id']))
        if method and method.get('is_active'):
            token = method.get('payment_method_id') or ''

    if not token:
        handle_failed_charge(sub, reason='no token')
        return

    if int(sub.get('converts_from_trial') or 0):
        # Сумма из настроек панели (trial_tariff)
        amount, *_ = _get_trial_conversion_params()
    else:
        amount = float(sub.get('amount') or 0)

    if amount <= 0:
        handle_failed_charge(sub, reason='invalid amount')
        return

    invoice_id = f'renew_{sub_id}_{uuid.uuid4().hex[:10]}'
    result = cloudpayments.cloudpayments_api.charge_by_token(
        amount=amount,
        account_id=str(user_id),
        token=token,
        invoice_id=invoice_id,
        description=f'1FEDERAL VPN — автопродление ({int(sub.get("duration_days") or 30)} дн.)',
        json_data={
            'subscription_id': sub_id,
            'user_id': user_id,
            'kind': 'recurring_renewal',
        },
    )

    if result.get('ok'):
        tx_id = result.get('transaction_id')
        if tx_id and database.transaction_exists_by_payment_id(str(tx_id), 'CloudPayments'):
            logger.info('Recurring %s already processed tx=%s', sub_id, tx_id)
            return
        handle_successful_charge(sub, transaction_id=tx_id, amount=amount)
        return

    status = str(result.get('status') or '')
    if status in ('AwaitingAuthentication', 'Pending'):
        database.update_recurring_subscription(
            sub_id,
            next_charge_at=_iso(_now() + timedelta(minutes=15)),
        )
        return

    # Определяем: это pre-expiry или post-expiry попытка?
    # Смотрим на vpn_key expiry, чтобы понять, не истекла ли ещё подписка
    is_pre = _is_pre_expiry_attempt(sub)

    if is_pre:
        # Попытка до истечения — планируем следующую pre-expiry точку
        next_pre = _next_pre_expiry_attempt(sub)
        if next_pre is not None:
            database.update_recurring_subscription(
                sub_id,
                status='PAST_DUE',
                fail_notified=int(sub.get('fail_notified') or 0),
                next_charge_at=_iso(next_pre),
            )
            logger.info('Recurring %s pre-expiry fail, next pre-expiry attempt at %s', sub_id, _iso(next_pre))
        else:
            # Все pre-expiry точки пройдены — переходим к post-expiry
            handle_failed_charge(sub, reason=str(result.get('reason') or result.get('error') or status), is_pre_expiry=False)
    else:
        handle_failed_charge(sub, reason=str(result.get('reason') or result.get('error') or status), is_pre_expiry=False)


def _is_pre_expiry_attempt(sub: Dict[str, Any]) -> bool:
    """Возвращает True если попытка произошла ДО истечения подписки."""
    vpn_key_id = int(sub.get('vpn_key_id') or 0)
    if not vpn_key_id:
        return False
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT expiry_date FROM vpn_keys WHERE id = ?', (vpn_key_id,))
        row = cursor.fetchone()
        if not row or not row['expiry_date']:
            return False
        expiry_dt = datetime.fromisoformat(str(row['expiry_date']).replace('Z', '+00:00').replace('+00:00', ''))
        return expiry_dt > _now()
    except Exception:
        return False
    finally:
        conn.close()


def _next_pre_expiry_attempt(sub: Dict[str, Any]) -> Optional[datetime]:
    """Вернуть следующую pre-expiry точку для попытки, или None если все пройдены."""
    vpn_key_id = int(sub.get('vpn_key_id') or 0)
    if not vpn_key_id:
        return None
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT expiry_date FROM vpn_keys WHERE id = ?', (vpn_key_id,))
        row = cursor.fetchone()
        if not row or not row['expiry_date']:
            return None
        expiry_dt = datetime.fromisoformat(str(row['expiry_date']).replace('Z', '+00:00').replace('+00:00', ''))
    except Exception:
        return None
    finally:
        conn.close()

    now = _now()
    for h in PRE_EXPIRY_SCHEDULE_HOURS:
        candidate = expiry_dt + timedelta(hours=h)
        if candidate > now + timedelta(minutes=5):  # с небольшим буфером
            return candidate
    return None
