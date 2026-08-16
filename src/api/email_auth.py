"""Email auth, Telegram link, and account-merge HTTP handlers."""
from __future__ import annotations

import json
import logging
import re
from typing import Callable

from flask import jsonify, request

from src.database import database
from src.api import mailer
from src.api import account_link
from src.core import core, abuse_detected

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$')
MIN_PASSWORD_LEN = 8


def _norm_email(email: str) -> str:
    return (email or '').strip().lower()


def _valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(_norm_email(email)))


def _client_ip() -> str:
    forwarded = request.headers.get('X-Forwarded-For', '').strip()
    if forwarded:
        return forwarded.split(',')[0].strip()
    return (request.remote_addr or '').strip()


def _ban_check(user: dict):
    if not user:
        return None
    tid = user.get('telegram_id')
    if tid and core.check_blacklist(int(tid)):
        return (jsonify({'error': 'Доступ ограничен', 'banned': True}), 403)
    ban_status = abuse_detected.check_user_ban_status(user['id'], tid)
    if ban_status.get('banned'):
        return (jsonify({'error': ban_status.get('reason', 'Аккаунт заблокирован'), 'banned': True}), 403)
    return None


def _pending_for(user_id: int):
    link = database.get_pending_account_link_for_user(user_id)
    if not link:
        return None
    return account_link.build_pending_payload(link)


def _session_for_user(user: dict, photo_url: str=None) -> str | None:
    return database.create_miniapp_session(
        telegram_id=user.get('telegram_id'),
        username=user.get('username'),
        first_name=user.get('full_name'),
        photo_url=photo_url,
        user_id=user['id'],
    )


def register_email_auth_routes(app, *, get_current_user: Callable, verify_telegram_login_widget: Callable):

    @app.route('/api/auth/email/register', methods=['POST'])
    def email_register():
        data = request.json or {}
        email = _norm_email(data.get('email') or '')
        password = data.get('password') or ''
        if not _valid_email(email):
            return (jsonify({'error': 'Некорректный email'}), 400)
        if len(password) < MIN_PASSWORD_LEN:
            return (jsonify({'error': f'Пароль не короче {MIN_PASSWORD_LEN} символов'}), 400)
        existing = database.get_user_by_email(email)
        if existing and existing.get('email_verified_at') and existing.get('password_hash'):
            return (jsonify({'error': 'Этот email уже зарегистрирован'}), 409)
        if database.count_recent_email_otps(email, 'register', 60) >= 3:
            return (jsonify({'error': 'Слишком много запросов. Подождите минуту'}), 429)
        password_hash = database.hash_user_password(password)
        payload = json.dumps({'password_hash': password_hash, 'mode': 'register'})
        code = database.create_email_otp(email, 'register', payload=payload, ip_address=_client_ip())
        if not code:
            return (jsonify({'error': 'Не удалось создать код'}), 500)
        if not mailer.send_otp_email(email, code, 'register'):
            return (jsonify({'error': 'Не удалось отправить письмо. Проверьте настройки SMTP'}), 502)
        return jsonify({'success': True, 'email': email, 'message': 'Код отправлен на почту'})

    @app.route('/api/auth/email/login', methods=['POST'])
    def email_login():
        data = request.json or {}
        email = _norm_email(data.get('email') or '')
        password = data.get('password') or ''
        if not _valid_email(email) or not password:
            return (jsonify({'error': 'Укажите email и пароль'}), 400)
        user = database.get_user_by_email(email)
        if not user or not user.get('password_hash') or not database.verify_user_password(user['password_hash'], password):
            return (jsonify({'error': 'Неверный email или пароль'}), 401)
        if not user.get('email_verified_at'):
            return (jsonify({'error': 'Email не подтверждён. Завершите регистрацию'}), 403)
        banned = _ban_check(user)
        if banned:
            return banned
        if database.count_recent_email_otps(email, 'login', 60) >= 3:
            return (jsonify({'error': 'Слишком много запросов. Подождите минуту'}), 429)
        code = database.create_email_otp(email, 'login', user_id=user['id'], ip_address=_client_ip())
        if not code:
            return (jsonify({'error': 'Не удалось создать код'}), 500)
        if not mailer.send_otp_email(email, code, 'login'):
            return (jsonify({'error': 'Не удалось отправить письмо'}), 502)
        return jsonify({'success': True, 'email': email, 'message': 'Код отправлен на почту'})

    @app.route('/api/auth/email/verify', methods=['POST'])
    def email_verify():
        data = request.json or {}
        email = _norm_email(data.get('email') or '')
        code = (data.get('code') or '').strip()
        purpose = (data.get('purpose') or 'login').strip()
        if purpose not in ('register', 'login'):
            return (jsonify({'error': 'Некорректный purpose'}), 400)
        ok, otp, err = database.verify_email_otp(email, purpose, code)
        if not ok:
            return (jsonify({'error': err or 'Неверный код'}), 400)

        if purpose == 'register':
            payload = {}
            try:
                payload = json.loads(otp.get('payload') or '{}')
            except Exception:
                payload = {}
            password_hash = payload.get('password_hash')
            if not password_hash:
                return (jsonify({'error': 'Сессия регистрации устарела'}), 400)
            user = database.get_user_by_email(email)
            if user:
                database.set_user_email(user['id'], email=email, password_hash=password_hash, verified=True)
            else:
                user_id = database.create_user(
                    telegram_id=None,
                    username=email.split('@')[0],
                    email=email,
                    password_hash=password_hash,
                    email_verified=True,
                )
                user = database.get_user_by_id(user_id)
            if not user:
                return (jsonify({'error': 'Не удалось создать пользователя'}), 500)
        else:
            user = database.get_user_by_email(email)
            if not user:
                return (jsonify({'error': 'Пользователь не найден'}), 404)

        banned = _ban_check(user)
        if banned:
            return banned
        token = _session_for_user(user)
        if not token:
            return (jsonify({'error': 'Не удалось создать сессию'}), 500)
        return jsonify({
            'success': True,
            'session_token': token,
            'user_id': user['id'],
            'telegram_id': user.get('telegram_id'),
            'email': user.get('email'),
            'username': user.get('username'),
            'first_name': user.get('full_name'),
            'pending_link': _pending_for(user['id']),
        })

    @app.route('/api/auth/email/link/start', methods=['POST'])
    def email_link_start():
        user = get_current_user()
        if not user:
            return (jsonify({'error': 'Unauthorized'}), 401)
        data = request.json or {}
        email = _norm_email(data.get('email') or '')
        password = data.get('password') or ''
        if not _valid_email(email):
            return (jsonify({'error': 'Некорректный email'}), 400)
        if len(password) < MIN_PASSWORD_LEN:
            return (jsonify({'error': f'Пароль не короче {MIN_PASSWORD_LEN} символов'}), 400)

        existing = database.get_user_by_email(email)
        password_hash = database.hash_user_password(password)

        # Same user changing/reconfirming email
        if existing and existing['id'] == user['id']:
            if database.count_recent_email_otps(email, 'change', 60) >= 3:
                return (jsonify({'error': 'Слишком много запросов'}), 429)
            code = database.create_email_otp(email, 'change', user_id=user['id'], payload=json.dumps({'password_hash': password_hash}), ip_address=_client_ip())
            if not code or not mailer.send_otp_email(email, code, 'change'):
                return (jsonify({'error': 'Не удалось отправить код'}), 502)
            return jsonify({'success': True, 'needs_otp': True, 'purpose': 'change', 'email': email})

        if existing and existing['id'] != user['id']:
            # Conflict — may need merge
            if account_link.needs_merge_choice(user['id'], existing['id']) or database.user_has_active_subscription(existing['id']) or database.user_has_active_subscription(user['id']):
                link_id = database.create_pending_account_link(
                    initiator_user_id=user['id'],
                    other_user_id=existing['id'],
                    link_type='email',
                    link_email=email,
                    link_password_hash=password_hash,
                    status='awaiting_choice',
                )
                link = database.get_pending_account_link(link_id)
                return jsonify({
                    'success': True,
                    'conflict': True,
                    'pending_link': account_link.build_pending_payload(link),
                })
            # Soft conflict: other account exists but empty — still force merge choice if both have anything useful
            link_id = database.create_pending_account_link(
                initiator_user_id=user['id'],
                other_user_id=existing['id'],
                link_type='email',
                link_email=email,
                link_password_hash=password_hash,
                status='awaiting_choice',
            )
            link = database.get_pending_account_link(link_id)
            return jsonify({
                'success': True,
                'conflict': True,
                'pending_link': account_link.build_pending_payload(link),
            })

        # Free email — send OTP to attach
        purpose = 'link' if not user.get('email') else 'change'
        if database.count_recent_email_otps(email, purpose, 60) >= 3:
            return (jsonify({'error': 'Слишком много запросов'}), 429)
        code = database.create_email_otp(
            email, purpose, user_id=user['id'],
            payload=json.dumps({'password_hash': password_hash}),
            ip_address=_client_ip(),
        )
        if not code or not mailer.send_otp_email(email, code, purpose):
            return (jsonify({'error': 'Не удалось отправить код'}), 502)
        return jsonify({'success': True, 'needs_otp': True, 'purpose': purpose, 'email': email})

    @app.route('/api/auth/email/link/confirm', methods=['POST'])
    def email_link_confirm():
        user = get_current_user()
        if not user:
            return (jsonify({'error': 'Unauthorized'}), 401)
        data = request.json or {}
        email = _norm_email(data.get('email') or '')
        code = (data.get('code') or '').strip()
        purpose = (data.get('purpose') or 'link').strip()
        if purpose not in ('link', 'change'):
            return (jsonify({'error': 'Некорректный purpose'}), 400)
        ok, otp, err = database.verify_email_otp(email, purpose, code)
        if not ok:
            return (jsonify({'error': err or 'Неверный код'}), 400)
        payload = {}
        try:
            payload = json.loads(otp.get('payload') or '{}')
        except Exception:
            payload = {}
        password_hash = payload.get('password_hash')
        if not database.set_user_email(user['id'], email=email, password_hash=password_hash, verified=True):
            return (jsonify({'error': 'Не удалось привязать email (возможно, уже занят)'}), 409)
        user = database.get_user_by_id(user['id'])
        return jsonify({
            'success': True,
            'email': user.get('email'),
            'user_id': user['id'],
            'pending_link': _pending_for(user['id']),
        })

    @app.route('/api/auth/email/unlink', methods=['POST'])
    def email_unlink():
        user = get_current_user()
        if not user:
            return (jsonify({'error': 'Unauthorized'}), 401)
        data = request.json or {}
        step = (data.get('step') or 'start').strip()
        email = _norm_email(user.get('email') or '')
        if not email:
            return (jsonify({'error': 'Email не привязан'}), 400)
        if not user.get('telegram_id'):
            return (jsonify({'error': 'Нельзя отвязать email без привязанного Telegram'}), 400)

        if step == 'start':
            if database.count_recent_email_otps(email, 'unlink', 60) >= 3:
                return (jsonify({'error': 'Слишком много запросов'}), 429)
            code = database.create_email_otp(email, 'unlink', user_id=user['id'], ip_address=_client_ip())
            if not code or not mailer.send_otp_email(email, code, 'unlink'):
                return (jsonify({'error': 'Не удалось отправить код'}), 502)
            return jsonify({'success': True, 'needs_otp': True, 'purpose': 'unlink', 'email': email})

        code = (data.get('code') or '').strip()
        ok, _, err = database.verify_email_otp(email, 'unlink', code)
        if not ok:
            return (jsonify({'error': err or 'Неверный код'}), 400)
        database.clear_user_email(user['id'])
        return jsonify({'success': True, 'email': None})

    @app.route('/api/auth/telegram/link', methods=['POST'])
    def telegram_link():
        user = get_current_user()
        if not user:
            return (jsonify({'error': 'Unauthorized'}), 401)
        data = request.json or {}
        tg_user = verify_telegram_login_widget(data)
        if not tg_user:
            return (jsonify({'error': 'Недействительные данные Telegram'}), 401)
        telegram_id = int(tg_user['id'])
        if core.check_blacklist(telegram_id):
            return (jsonify({'error': 'Доступ ограничен', 'banned': True}), 403)

        existing = database.get_user_by_telegram_id(telegram_id)
        username = tg_user.get('username') or None
        first_name = tg_user.get('first_name') or None

        if existing and existing['id'] == user['id']:
            database.set_user_telegram_id(user['id'], telegram_id=telegram_id, username=username, full_name=first_name)
            return jsonify({'success': True, 'telegram_id': telegram_id, 'pending_link': _pending_for(user['id'])})

        if existing and existing['id'] != user['id']:
            # Link TG first into pending, then ask merge (per plan: ask AFTER TG bind success path)
            link_id = database.create_pending_account_link(
                initiator_user_id=user['id'],
                other_user_id=existing['id'],
                link_type='telegram',
                link_telegram_id=telegram_id,
                payload=json.dumps({'username': username, 'first_name': first_name}),
                status='awaiting_choice',
            )
            link = database.get_pending_account_link(link_id)
            return jsonify({
                'success': True,
                'conflict': True,
                'telegram_linked_pending': True,
                'pending_link': account_link.build_pending_payload(link),
            })

        if not database.set_user_telegram_id(user['id'], telegram_id=telegram_id, username=username, full_name=first_name):
            return (jsonify({'error': 'Не удалось привязать Telegram'}), 409)
        return jsonify({'success': True, 'telegram_id': telegram_id})

    @app.route('/api/auth/link/choose-primary', methods=['POST'])
    def link_choose_primary():
        user = get_current_user()
        if not user:
            return (jsonify({'error': 'Unauthorized'}), 401)
        data = request.json or {}
        link_id = data.get('link_id')
        primary_user_id = data.get('primary_user_id')
        link = database.get_pending_account_link(int(link_id)) if link_id else database.get_pending_account_link_for_user(user['id'])
        if not link or link['status'] not in ('awaiting_choice', 'awaiting_confirm'):
            return (jsonify({'error': 'Нет активного запроса на объединение'}), 404)
        if user['id'] not in (link['initiator_user_id'], link['other_user_id']):
            return (jsonify({'error': 'Forbidden'}), 403)
        primary_user_id = int(primary_user_id)
        if primary_user_id not in (link['initiator_user_id'], link['other_user_id']):
            return (jsonify({'error': 'Некорректный выбор основной подписки'}), 400)

        database.update_pending_account_link(link['id'], chosen_primary_user_id=primary_user_id, status='awaiting_confirm')
        link = database.get_pending_account_link(link['id'])

        # Email link: require OTP before merge
        if link['link_type'] == 'email':
            email = link.get('link_email')
            if not email:
                return (jsonify({'error': 'Нет email для подтверждения'}), 400)
            if database.count_recent_email_otps(email, 'merge', 60) >= 3:
                return (jsonify({'error': 'Слишком много запросов'}), 429)
            code = database.create_email_otp(email, 'merge', user_id=user['id'], payload=json.dumps({'link_id': link['id']}), ip_address=_client_ip())
            if not code or not mailer.send_otp_email(email, code, 'merge'):
                return (jsonify({'error': 'Не удалось отправить код'}), 502)
            return jsonify({
                'success': True,
                'needs_otp': True,
                'purpose': 'merge',
                'email': email,
                'pending_link': account_link.build_pending_payload(link),
            })

        # Telegram link: merge immediately after choice (TG already verified)
        return _finalize_merge(link, otp_code=None, skip_otp=True)

    @app.route('/api/auth/link/confirm-merge', methods=['POST'])
    def link_confirm_merge():
        user = get_current_user()
        if not user:
            return (jsonify({'error': 'Unauthorized'}), 401)
        data = request.json or {}
        link_id = data.get('link_id')
        code = (data.get('code') or '').strip()
        link = database.get_pending_account_link(int(link_id)) if link_id else database.get_pending_account_link_for_user(user['id'])
        if not link or link['status'] != 'awaiting_confirm':
            return (jsonify({'error': 'Нет запроса, ожидающего подтверждения'}), 404)
        if user['id'] not in (link['initiator_user_id'], link['other_user_id']):
            return (jsonify({'error': 'Forbidden'}), 403)
        return _finalize_merge(link, otp_code=code, skip_otp=False)

    def _finalize_merge(link: dict, otp_code: str | None, skip_otp: bool):
        if not skip_otp:
            email = link.get('link_email')
            if not email:
                return (jsonify({'error': 'Нет email'}), 400)
            ok, _, err = database.verify_email_otp(email, 'merge', otp_code or '')
            if not ok:
                return (jsonify({'error': err or 'Неверный код'}), 400)

        primary_id = int(link.get('chosen_primary_user_id') or 0)
        secondary_id = link['other_user_id'] if primary_id == link['initiator_user_id'] else link['initiator_user_id']
        if not primary_id:
            return (jsonify({'error': 'Не выбран основной аккаунт'}), 400)

        # Apply pending identity onto the accounts before merge so fields survive
        if link['link_type'] == 'email' and link.get('link_email'):
            # Ensure email lands on primary after merge via account_link.merge_accounts
            pass
        if link['link_type'] == 'telegram' and link.get('link_telegram_id'):
            # Clear from secondary during merge; set on primary inside merge
            pass

        ok, msg = account_link.merge_accounts(primary_id, secondary_id)
        if not ok:
            return (jsonify({'error': msg}), 500)

        primary = database.get_user_by_id(primary_id)
        if link['link_type'] == 'email' and link.get('link_email') and primary:
            database.set_user_email(
                primary_id,
                email=link['link_email'],
                password_hash=link.get('link_password_hash') or primary.get('password_hash'),
                verified=True,
            )
        if link['link_type'] == 'telegram' and link.get('link_telegram_id') and primary:
            payload = {}
            try:
                payload = json.loads(link.get('payload') or '{}')
            except Exception:
                payload = {}
            database.set_user_telegram_id(
                primary_id,
                telegram_id=int(link['link_telegram_id']),
                username=payload.get('username'),
                full_name=payload.get('first_name'),
            )

        database.update_pending_account_link(link['id'], status='done')
        primary = database.get_user_by_id(primary_id)
        token = _session_for_user(primary) if primary else None
        return jsonify({
            'success': True,
            'message': msg,
            'user_id': primary_id,
            'session_token': token,
            'telegram_id': primary.get('telegram_id') if primary else None,
            'email': primary.get('email') if primary else None,
            'pending_link': None,
        })
