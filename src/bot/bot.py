import asyncio
import logging
import os
import sys
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, CallbackQuery
from aiogram.enums import ParseMode
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../'))
from backend.database import database
from backend.core import core, abuse_detected
from backend.core.blacklist_updater import start_blacklist_updater
import re
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
WEB_APP_URL = os.getenv('MINIAPP_URL', '')
SUPPORT_URL = os.getenv('SUPPORT_URL', 'https://t.me/onefederalbot')
if not BOT_TOKEN:
    logger.error('❌ TELEGRAM_BOT_TOKEN не указан в .env!')
    sys.exit(1)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

def extract_referral_id(text: str) -> int:
    match = re.search('ref(\\d+)', text)
    if match:
        return int(match.group(1))
    match = re.search('ref=(\\d+)', text)
    return int(match.group(1)) if match else None

@dp.message(CommandStart())

async def cmd_start(message: types.Message):
    telegram_id = message.from_user.id
    if core.check_blacklist(telegram_id):
        await message.answer('❌ Ваш аккаунт заблокирован.')
        return
    referral_id = None
    if message.text and 'ref' in message.text:
        referral_id = extract_referral_id(message.text)
    if referral_id == telegram_id:
        referral_id = None
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        username = message.from_user.username
        full_name = message.from_user.full_name
        referred_by = None
        if referral_id:
            ref_user = database.get_user_by_telegram_id(referral_id)
            if ref_user:
                if database.check_referral_rate_limit(referral_id, limit=25, window_seconds=60):
                    referred_by = ref_user['id']
                    logger.info(f'Referral accepted: user {telegram_id} referred by {referral_id}')
                else:
                    logger.warning(f'Referral rate limit exceeded for referrer {referral_id}')
        user_id = database.create_user(telegram_id, username, full_name, referred_by)
        user = database.get_user_by_id(user_id)
    elif referral_id and user.get('referred_by') is None:
        ref_user = database.get_user_by_telegram_id(referral_id)
        if ref_user:
            if database.check_referral_rate_limit(referral_id, limit=25, window_seconds=60):
                if database.set_referrer_for_user(user['id'], ref_user['id']):
                    logger.info(f'Referral set for existing user {telegram_id} -> {referral_id}')
                    user = database.get_user_by_telegram_id(telegram_id)
            else:
                logger.warning(f'Referral rate limit exceeded for referrer {referral_id}')
    ban_status = abuse_detected.check_user_ban_status(user['id'])
    if ban_status.get('banned'):
        await message.answer('❌ Ваш аккаунт заблокирован.\n\nЕсли вы считаете, что это ошибка, свяжитесь со службой поддержки.', reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text='Служба поддержки', url=SUPPORT_URL)]]))
        return
    text = '<tg-emoji emoji-id="6028346797368283073">✈️</tg-emoji> Привет, мы — 1FEDERAL VPN!\n\nБезопасный VPN, который использует новейшие технологии для обхода блокировок и безопасности в интернете.\n\nНажми на кнопку, чтобы начать <tg-emoji emoji-id="5305522282695768654">👇</tg-emoji>'
    keyboard = None
    if WEB_APP_URL:
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text='📱 Открыть приложение', web_app=WebAppInfo(url=WEB_APP_URL))]])
    await message.answer(text, parse_mode=ParseMode.HTML, reply_markup=keyboard)
withdrawal_reject_states = {}

@dp.callback_query(F.data.startswith('withdraw_approve_'))

async def handle_withdraw_approve(callback: CallbackQuery):
    try:
        transaction_id = int(callback.data.split('_')[-1])
        confirm_keyboard = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text='✅ Да, выполнить', callback_data=f'withdraw_confirm_{transaction_id}'), InlineKeyboardButton(text='❌ Отмена', callback_data=f'withdraw_cancel_{transaction_id}')]])
        await callback.message.edit_reply_markup(reply_markup=confirm_keyboard)
        await callback.answer('Подтвердите выполнение вывода')
    except Exception as e:
        logger.error(f'Error handling withdraw approve: {e}')
        await callback.answer('Ошибка обработки', show_alert=True)

@dp.callback_query(F.data.startswith('withdraw_confirm_'))

async def handle_withdraw_confirm(callback: CallbackQuery):
    try:
        transaction_id = int(callback.data.split('_')[-1])
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute('\n            SELECT t.*, u.telegram_id, u.username\n            FROM transactions t\n            JOIN users u ON t.user_id = u.id\n            WHERE t.id = ?\n        ', (transaction_id,))
        transaction = cursor.fetchone()
        if not transaction:
            await callback.answer('Транзакция не найдена', show_alert=True)
            return
        cursor.execute("\n            UPDATE transactions SET status = 'Success' WHERE id = ?\n        ", (transaction_id,))
        conn.commit()
        conn.close()
        amount = abs(float(transaction['amount']))
        core.send_notification_to_user(transaction['telegram_id'], f"✅ <b>Вывод средств выполнен!</b>\n\n💵 Сумма: {amount}₽\n💳 Метод: {transaction['payment_method']}\n\nДеньги отправлены. Спасибо за использование 1FEDERAL VPN!")
        await callback.message.delete()
        await callback.answer('Вывод успешно выполнен!', show_alert=True)
    except Exception as e:
        logger.error(f'Error confirming withdrawal: {e}')
        await callback.answer('Ошибка обработки', show_alert=True)

@dp.callback_query(F.data.startswith('withdraw_reject_'))

async def handle_withdraw_reject(callback: CallbackQuery):
    try:
        transaction_id = int(callback.data.split('_')[-1])
        reason_keyboard = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text='Без причины', callback_data=f'withdraw_reject_confirm_{transaction_id}_none')], [InlineKeyboardButton(text='Подозрительная активность', callback_data=f'withdraw_reject_confirm_{transaction_id}_suspicious')], [InlineKeyboardButton(text='Неверные реквизиты', callback_data=f'withdraw_reject_confirm_{transaction_id}_invalid')], [InlineKeyboardButton(text='❌ Отмена', callback_data=f'withdraw_cancel_{transaction_id}')]])
        await callback.message.edit_reply_markup(reply_markup=reason_keyboard)
        await callback.answer('Выберите причину отказа')
    except Exception as e:
        logger.error(f'Error handling withdraw reject: {e}')
        await callback.answer('Ошибка обработки', show_alert=True)

@dp.callback_query(F.data.startswith('withdraw_reject_confirm_'))

async def handle_withdraw_reject_confirm(callback: CallbackQuery):
    try:
        parts = callback.data.split('_')
        transaction_id = int(parts[3])
        reason_code = parts[4] if len(parts) > 4 else 'none'
        reasons = {'none': '', 'suspicious': 'Подозрительная активность', 'invalid': 'Неверные реквизиты'}
        reason = reasons.get(reason_code, '')
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute('\n            SELECT t.*, u.telegram_id, u.username\n            FROM transactions t\n            JOIN users u ON t.user_id = u.id\n            WHERE t.id = ?\n        ', (transaction_id,))
        transaction = cursor.fetchone()
        if not transaction:
            await callback.answer('Транзакция не найдена', show_alert=True)
            return
        amount = abs(float(transaction['amount']))
        user_id = transaction['user_id']
        cursor.execute('\n            UPDATE users SET partner_balance = partner_balance + ? WHERE id = ?\n        ', (amount, user_id))
        cursor.execute("\n            UPDATE transactions SET status = 'Rejected', description = description || ' | Причина отказа: ' || ? WHERE id = ?\n        ", (reason or 'Не указана', transaction_id))
        conn.commit()
        conn.close()
        reject_msg = f'❌ <b>Вывод средств отклонён</b>\n\n💵 Сумма: {amount}₽\n'
        if reason:
            reject_msg += f'📝 Причина: {reason}\n'
        reject_msg += '\n💰 Средства возвращены на ваш реферальный баланс.'
        core.send_notification_to_user(transaction['telegram_id'], reject_msg)
        await callback.message.delete()
        await callback.answer('Вывод отклонён, средства возвращены', show_alert=True)
    except Exception as e:
        logger.error(f'Error confirming rejection: {e}')
        await callback.answer('Ошибка обработки', show_alert=True)

@dp.callback_query(F.data.startswith('withdraw_cancel_'))

async def handle_withdraw_cancel(callback: CallbackQuery):
    try:
        transaction_id = int(callback.data.split('_')[-1])
        original_keyboard = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text='✅ Принять', callback_data=f'withdraw_approve_{transaction_id}'), InlineKeyboardButton(text='❌ Отказать', callback_data=f'withdraw_reject_{transaction_id}')]])
        await callback.message.edit_reply_markup(reply_markup=original_keyboard)
        await callback.answer('Действие отменено')
    except Exception as e:
        logger.error(f'Error canceling: {e}')
        await callback.answer('Ошибка', show_alert=True)

async def subscription_notifications_task():
    while True:
        try:
            await asyncio.sleep(3600)
            conn = database.get_db_connection()
            cursor = conn.cursor()
            from datetime import datetime, timedelta
            now = datetime.now()
            notification_intervals = [(3, 'days', '3 дня'), (2, 'days', '2 дня'), (1, 'days', '1 день'), (3, 'hours', '3 часа')]
            for value, unit, text in notification_intervals:
                if unit == 'days':
                    target_time = now + timedelta(days=value)
                    window_start = target_time - timedelta(hours=1)
                    window_end = target_time + timedelta(hours=1)
                else:
                    target_time = now + timedelta(hours=value)
                    window_start = target_time - timedelta(minutes=30)
                    window_end = target_time + timedelta(minutes=30)
                cursor.execute("\n                    SELECT vk.id, vk.key_uuid, vk.expiry_date, u.telegram_id\n                    FROM vpn_keys vk\n                    JOIN users u ON vk.user_id = u.id\n                    WHERE vk.status = 'Active'\n                      AND datetime(vk.expiry_date) BETWEEN ? AND ?\n                ", (window_start.isoformat(), window_end.isoformat()))
                for row in cursor.fetchall():
                    key_id = row['id']
                    key_uuid = row['key_uuid']
                    telegram_id = row['telegram_id']
                    short_id = key_uuid[:8] if key_uuid else f'#{key_id}'
                    msg = f'⚠️ <b>Ваша подписка скоро закончится</b>\n\nЧерез {text} ваш ключ {short_id} закончится. Чтобы сохранить доступ в свободный интернет, оплатите подписку!'
                    core.send_notification_to_user(telegram_id, msg)
                    logger.info(f'Sent expiry reminder ({text}) to {telegram_id} for key {key_id}')
            cursor.execute("\n                SELECT vk.id, vk.key_uuid, vk.expiry_date, u.telegram_id\n                FROM vpn_keys vk\n                JOIN users u ON vk.user_id = u.id\n                WHERE vk.status = 'Active'\n                  AND datetime(vk.expiry_date) < ?\n            ", (now.isoformat(),))
            for row in cursor.fetchall():
                key_id = row['id']
                telegram_id = row['telegram_id']
                cursor.execute("UPDATE vpn_keys SET status = 'Expired' WHERE id = ?", (key_id,))
                msg = '❌ <b>Ваша подписка закончилась.</b>\n\nВскоре она будет окончательно удалена. Чтобы не перенастраивать всё заново, продлите подписку в разделе "Устройства"'
                core.send_notification_to_user(telegram_id, msg)
                logger.info(f'Subscription expired for key {key_id}, notified user {telegram_id}')
            nine_days_ago = now - timedelta(days=9)
            cursor.execute("\n                SELECT vk.id, vk.key_uuid, vk.expiry_date, u.telegram_id\n                FROM vpn_keys vk\n                JOIN users u ON vk.user_id = u.id\n                WHERE vk.status = 'Expired'\n                  AND datetime(vk.expiry_date) BETWEEN ? AND ?\n            ", ((nine_days_ago - timedelta(hours=1)).isoformat(), (nine_days_ago + timedelta(hours=1)).isoformat()))
            for row in cursor.fetchall():
                telegram_id = row['telegram_id']
                msg = '❗️ <b>Ваша подписка будет удалена</b>\n\nЧерез 24 часа ваша подписка будет окончательно удалена. Чтобы не потерять доступ, продлите подписку.'
                core.send_notification_to_user(telegram_id, msg)
            ten_days_ago = now - timedelta(days=10)
            cursor.execute("\n                SELECT vk.id, vk.key_uuid, vk.user_id, u.telegram_id\n                FROM vpn_keys vk\n                JOIN users u ON vk.user_id = u.id\n                WHERE vk.status = 'Expired'\n                  AND datetime(vk.expiry_date) < ?\n            ", (ten_days_ago.isoformat(),))
            for row in cursor.fetchall():
                key_id = row['id']
                key_uuid = row['key_uuid']
                user_id = row['user_id']
                if key_uuid:
                    try:
                        from backend.api import remnawave
                        remnawave.remnawave_api.delete_user_sync(key_uuid)
                        logger.info(f'Deleted key {key_uuid} from Remnawave')
                    except Exception as e:
                        logger.error(f'Failed to delete key {key_uuid} from Remnawave: {e}')
                cursor.execute('DELETE FROM vpn_keys WHERE id = ?', (key_id,))
                logger.info(f'Auto-deleted expired key {key_id} for user {user_id}')
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f'Error in subscription_notifications_task: {e}')
            await asyncio.sleep(60)

async def auto_renewal_task():
    while True:
        try:
            await asyncio.sleep(300)
            conn = database.get_db_connection()
            cursor = conn.cursor()
            from datetime import datetime, timedelta
            now = datetime.now()
            check_window_start = now + timedelta(minutes=55)
            check_window_end = now + timedelta(minutes=65)
            cursor.execute("\n                SELECT vk.id, vk.key_uuid, vk.expiry_date, vk.plan_type, vk.traffic_limit,\n                       u.id as user_id, u.telegram_id, u.balance, u.username\n                FROM vpn_keys vk\n                JOIN users u ON vk.user_id = u.id\n                WHERE vk.status = 'Active'\n                  AND datetime(vk.expiry_date) BETWEEN ? AND ?\n            ", (check_window_start.isoformat(), check_window_end.isoformat()))
            expiring_keys = cursor.fetchall()
            for row in expiring_keys:
                key_id = row['id']
                key_uuid = row['key_uuid']
                user_id = row['user_id']
                telegram_id = row['telegram_id']
                balance = float(row['balance'] or 0)
                plan_type = row['plan_type'] or 'vpn'
                cursor.execute("\n                    SELECT price, duration_days FROM tariff_plans\n                    WHERE plan_type = 'vpn' AND duration_days = 1 AND is_active = 1\n                    LIMIT 1\n                ")
                tariff_row = cursor.fetchone()
                renewal_price = float(tariff_row['price']) if tariff_row else 5
                renewal_days = int(tariff_row['duration_days']) if tariff_row else 1
                if balance >= renewal_price:
                    try:
                        cursor.execute('BEGIN IMMEDIATE')
                        cursor.execute('SELECT balance FROM users WHERE id = ?', (user_id,))
                        current_balance = float(cursor.fetchone()['balance'] or 0)
                        if current_balance >= renewal_price:
                            new_balance = current_balance - renewal_price
                            cursor.execute('UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', (new_balance, user_id))
                            current_expiry = datetime.fromisoformat(row['expiry_date'].replace('Z', '+00:00').replace('+00:00', ''))
                            new_expiry = current_expiry + timedelta(days=renewal_days)
                            if key_uuid:
                                try:
                                    from backend.api import remnawave
                                    remnawave.remnawave_api.update_user_sync(uuid=key_uuid, expire_at=new_expiry)
                                except Exception as e:
                                    logger.error(f'Failed to update key {key_uuid} in Remnawave: {e}')
                                    cursor.execute('ROLLBACK')
                                    continue
                            cursor.execute('\n                                UPDATE vpn_keys SET expiry_date = ? WHERE id = ?\n                            ', (new_expiry.isoformat(), key_id))
                            cursor.execute("\n                                INSERT INTO transactions (user_id, type, amount, status, description, payment_method)\n                                VALUES (?, 'auto_renewal', ?, 'Success', ?, 'Balance')\n                            ", (user_id, -renewal_price, f'Автоматическое продление подписки ({renewal_days} дн.)'))
                            conn.commit()
                            core.send_notification_to_user(telegram_id, f"✅ <b>Подписка автоматически продлена!</b>\n\n💳 Списано с баланса: {renewal_price}₽\n📅 Новая дата окончания: {new_expiry.strftime('%d.%m.%Y')}\n💰 Остаток на балансе: {new_balance:.2f}₽\n\nЕсли вы не хотите автопродления, уменьшите баланс до 0.")
                            logger.info(f'Auto-renewed subscription for user {user_id} (key {key_id})')
                        else:
                            conn.rollback()
                    except Exception as e:
                        logger.error(f'Error auto-renewing subscription for key {key_id}: {e}')
                        try:
                            conn.rollback()
                        except:
                            pass
                else:
                    cursor.execute("\n                        SELECT COUNT(*) as cnt FROM transactions \n                        WHERE user_id = ? AND type = 'auto_renewal_warning' \n                        AND created_at > datetime('now', '-2 hours')\n                    ", (user_id,))
                    if cursor.fetchone()['cnt'] == 0:
                        core.send_notification_to_user(telegram_id, f'⚠️ <b>Подписка истекает через 1 час!</b>\n\nДля автоматического продления на балансе должно быть минимум {renewal_price}₽.\n💰 Ваш баланс: {balance:.2f}₽\n\nПополните баланс, чтобы не потерять доступ к VPN!')
                        cursor.execute("\n                            INSERT INTO transactions (user_id, type, amount, status, description)\n                            VALUES (?, 'auto_renewal_warning', 0, 'Info', 'Уведомление о недостатке средств для автопродления')\n                        ", (user_id,))
                        conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f'Error in auto_renewal_task: {e}')
            import traceback
            traceback.print_exc()
            await asyncio.sleep(60)

async def weekly_reminder_task():
    while True:
        try:
            await asyncio.sleep(86400)
            from datetime import datetime, timedelta
            if datetime.now().weekday() != 0:
                continue
            conn = database.get_db_connection()
            cursor = conn.cursor()
            six_months_ago = datetime.now() - timedelta(days=180)
            cursor.execute("\n                SELECT DISTINCT u.telegram_id, u.id\n                FROM users u\n                WHERE u.id IN (\n                    SELECT DISTINCT user_id FROM transactions \n                    WHERE type IN ('subscription', 'trial') \n                    AND created_at > ?\n                )\n                AND u.id NOT IN (\n                    SELECT user_id FROM vpn_keys WHERE status = 'Active'\n                )\n                AND (u.is_banned = 0 OR u.is_banned IS NULL)\n            ", (six_months_ago.isoformat(),))
            for row in cursor.fetchall():
                telegram_id = row['telegram_id']
                msg = '❔️ <b>Вы про нас не забыли?</b>\n\nА мы про вас нет. Вы приобретали подписку у нас и перестали пользоваться. Нам очень жаль, если наш сервис вам не понравился.\n\nНапишите нам в поддержку, чтобы мы разобрались с вашей проблемой и вы вновь могли пользоваться нашим сервисом!'
                core.send_notification_to_user(telegram_id, msg)
            conn.close()
        except Exception as e:
            logger.error(f'Error in weekly_reminder_task: {e}')
            await asyncio.sleep(3600)

async def auto_refund_expired_withdrawals():
    while True:
        try:
            await asyncio.sleep(3600)
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("\n                SELECT t.id, t.user_id, t.amount, u.telegram_id\n                FROM transactions t\n                JOIN users u ON t.user_id = u.id\n                WHERE t.type = 'withdrawal_request' \n                  AND t.status = 'Pending'\n                  AND datetime(t.created_at) < datetime('now', '-7 days')\n            ")
            expired = cursor.fetchall()
            for row in expired:
                trans_id = row['id']
                user_id = row['user_id']
                amount = abs(float(row['amount']))
                telegram_id = row['telegram_id']
                cursor.execute('\n                    UPDATE users SET partner_balance = partner_balance + ? WHERE id = ?\n                ', (amount, user_id))
                cursor.execute("\n                    UPDATE transactions SET status = 'Expired', description = description || ' | Автовозврат через 7 дней'\n                    WHERE id = ?\n                ", (trans_id,))
                core.send_notification_to_user(telegram_id, f'⏰ <b>Истёк срок обработки заявки на вывод</b>\n\n💵 Сумма: {amount}₽\n\nЗаявка не была обработана в течение 7 дней. Средства возвращены на ваш реферальный баланс.')
                logger.info(f'Auto-refunded withdrawal #{trans_id} for user {user_id}: {amount}₽')
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f'Error in auto_refund_expired_withdrawals: {e}')
            await asyncio.sleep(60)

async def main():
    start_blacklist_updater()
    asyncio.create_task(auto_refund_expired_withdrawals())
    asyncio.create_task(subscription_notifications_task())
    asyncio.create_task(weekly_reminder_task())
    asyncio.create_task(auto_renewal_task())
    logger.info('Бот запущен...')
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)
if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info('Бот остановлен')
