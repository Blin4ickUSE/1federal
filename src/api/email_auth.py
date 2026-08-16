"""Email auth (passwordless OTP), Telegram link, and account-merge HTTP handlers."""
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


def _session_for_user(user: dict, photo_url: str = None) -> str | None:
    return database.create_miniapp_session(
        telegram_id=user.get('telegram_id'),
        username=user.get('username'),
        first_name=user.get('full_name'),
        photo_url=photo_url,
        user_id=user['id'],
    )


def register_email_auth_routes(app, *, get_current_user: Callable, verify_telegram_login_widget: Callable):

    @app.route('/api/auth/email/start', methods=['POST'])
    @app.route('/api/auth/email/login', methods=['POST'])
    @app.route('/api/auth/email/register', methods=['POST'])
    def email_start():
        """Passwordless: email → OTP. Works for new and existing accounts."""
        data = request.json or {}
        email = _norm_email(data.get('email') or '')
        if not _valid_email(email):
            return (jsonify({'error': 'Некорректный email'}), 400)

        user = database.get_user_by_email(email)
        if user:
            banned = _ban_check(user)
            if banned:
                return banned

        if database.count_recent_email_otps(email, 'login', 60) >= 3:
            return (jsonify({'error': 'Слишком много запросов. Подождите минуту'}), 429)

        code = database.create_email_otp(
            email,
            'login',
            user_id=user['id'] if user else None,
            payload=json.dumps({'mode': 'passwordless'}),
            ip_address=_client_ip(),
        )
        if not code:
            return (jsonify({'error': 'Не удалось создать код'}), 500)
        if not mailer.send_otp_email(email, code, 'login'):
            return (jsonify({'error': 'Не удалось отправить письмо. Проверьте настройки SMTP / SPF'}), 502)
        return jsonify({
            'success': True,
            'email': email,
            'purpose': 'login',
            'message': 'Код отправлен на почту',
            'is_new': user is None,
        })

    @app.route('/api/auth/email/verify', methods=['POST'])
    def email_verify():
        data = request.json or {}
        email = _norm_email(data.get('email') or '')
        code = (data.get('code') or '').strip()
        purpose = (data.get('purpose') or 'login').strip()
        # Legacy clients may still send register
        if purpose in ('register', 'login', 'auth'):
            purpose = 'login'
        if purpose != 'login':
            return (jsonify({'error': 'Некорректный purpose'}), 400)
        ok, otp, err = database.verify_email_otp(email, purpose, code)
        if not ok:
            return (jsonify({'error': err or 'Неверный код'}), 400)

        user = database.get_user_by_email(email)
        if not user:
            user_id = database.create_user(
                telegram_id=None,
                username=email.split('@')[0][:32],
                email=email,
                password_hash=None,
                email_verified=True,
            )
            user = database.get_user_by_id(user_id)
        else:
            database.set_user_email(user['id'], email=email, verified=True)
            user = database.get_user_by_id(user['id'])

        if not user:
            return (jsonify({'error': 'Не удалось создать пользователя'}), 500)

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
        if not _valid_email(email):
            return (jsonify({'error': 'Некорректный email'}), 400)

        existing = database.get_user_by_email(email)

        if existing and existing['id'] == user['id']:
            if database.count_recent_email_otps(email, 'change', 60) >= 3:
                return (jsonify({'error': 'Слишком много запросов'}), 429)
            code = database.create_email_otp(email, 'change', user_id=user['id'], ip_address=_client_ip())
            if not code or not mailer.send_otp_email(email, code, 'change'):
                return (jsonify({'error': 'Не удалось отправить код'}), 502)
            return jsonify({'success': True, 'needs_otp': True, 'purpose': 'change', 'email': email})

        if existing and existing['id'] != user['id']:
            link_id = database.create_pending_account_link(
                initiator_user_id=user['id'],
                other_user_id=existing['id'],
                link_type='email',
                link_email=email,
                link_password_hash=None,
                status='awaiting_choice',
            )
            link = database.get_pending_account_link(link_id)
            return jsonify({
                'success': True,
                'conflict': True,
                'pending_link': account_link.build_pending_payload(link),
            })

        purpose = 'link' if not user.get('email') else 'change'
        if database.count_recent_email_otps(email, purpose, 60) >= 3:
            return (jsonify({'error': 'Слишком много запросов'}), 429)
        code = database.create_email_otp(email, purpose, user_id=user['id'], ip_address=_client_ip())
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
        ok, _, err = database.verify_email_otp(email, purpose, code)
        if not ok:
            return (jsonify({'error': err or 'Неверный код'}), 400)
        if not database.set_user_email(user['id'], email=email, verified=True):
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
            return (jsonify({'error': 'Нельзя отвязать email без Telegram'}), 400)

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

    # ── Telegram link + merge (unchanged flow, no password) ─────────
    @app.route('/api/auth/telegram/link', methods=['POST'])
    def telegram_link():
        user = get_current_user()
        if not user:
            return (jsonify({'error': 'Unauthorized'}), 401)
        data = request.json or {}
        widget = data.get('user') or data
        if not verify_telegram_login_widget(widget):
            return (jsonify({'error': 'Неверная подпись Telegram'}), 401)
        try:
            tid = int(widget.get('id'))
        except (TypeError, ValueError):
            return (jsonify({'error': 'Некорректный Telegram ID'}), 400)

        existing = database.get_user_by_telegram_id(tid)
        if existing and existing['id'] == user['id']:
            return jsonify({'success': True, 'telegram_id': tid})
        if existing and existing['id'] != user['id']:
            link_id = database.create_pending_account_link(
                initiator_user_id=user['id'],
                other_user_id=existing['id'],
                link_type='telegram',
                link_telegram_id=tid,
                status='awaiting_choice',
            )
            link = database.get_pending_account_link(link_id)
            return jsonify({
                'success': True,
                'conflict': True,
                'pending_link': account_link.build_pending_payload(link),
            })

        username = widget.get('username')
        full_name = ' '.join(filter(None, [widget.get('first_name'), widget.get('last_name')])).strip() or None
        if not database.set_user_telegram_id(user['id'], telegram_id=tid, username=username, full_name=full_name):
            return (jsonify({'error': 'Не удалось привязать Telegram'}), 400)
        user = database.get_user_by_id(user['id'])
        return jsonify({
            'success': True,
            'telegram_id': user.get('telegram_id'),
            'username': user.get('username'),
            'pending_link': _pending_for(user['id']),
        })

    @app.route('/api/auth/link/choose-primary', methods=['POST'])
    def link_choose_primary():
        user = get_current_user()
        if not user:
            return (jsonify({'error': 'Unauthorized'}), 401)
        data = request.json or {}
        link_id = data.get('link_id')
        primary_user_id = data.get('primary_user_id')
        try:
            link_id = int(link_id)
            primary_user_id = int(primary_user_id)
        except (TypeError, ValueError):
            return (jsonify({'error': 'Некорректные параметры'}), 400)
        link = database.get_pending_account_link(link_id)
        if not link or link.get('status') not in ('awaiting_choice', 'awaiting_otp'):
            return (jsonify({'error': 'Заявка не найдена'}), 404)
        if user['id'] not in (link['initiator_user_id'], link['other_user_id']):
            return (jsonify({'error': 'Нет доступа'}), 403)
        if primary_user_id not in (link['initiator_user_id'], link['other_user_id']):
            return (jsonify({'error': 'Некорректный primary'}), 400)

        database.update_pending_account_link(link_id, chosen_primary_user_id=primary_user_id, status='awaiting_otp')
        link = database.get_pending_account_link(link_id)

        email = _norm_email(link.get('link_email') or '')
        if link.get('link_type') == 'email' and email:
            if database.count_recent_email_otps(email, 'merge', 60) >= 3:
                return (jsonify({'error': 'Слишком много запросов'}), 429)
            code = database.create_email_otp(
                email, 'merge', user_id=user['id'],
                payload=json.dumps({'link_id': link['id']}),
                ip_address=_client_ip(),
            )
            if not code or not mailer.send_otp_email(email, code, 'merge'):
                return (jsonify({'error': 'Не удалось отправить код'}), 502)
            return jsonify({
                'success': True,
                'needs_otp': True,
                'purpose': 'merge',
                'email': email,
                'pending_link': account_link.build_pending_payload(link),
            })
        return _finalize_merge(link, otp_code=None, skip_otp=True)

    @app.route('/api/auth/link/confirm-merge', methods=['POST'])
    def link_confirm_merge():
        user = get_current_user()
        if not user:
            return (jsonify({'error': 'Unauthorized'}), 401)
        data = request.json or {}
        link_id = data.get('link_id')
        code = (data.get('code') or '').strip()
        try:
            link_id = int(link_id)
        except (TypeError, ValueError):
            return (jsonify({'error': 'Некорректный link_id'}), 400)
        link = database.get_pending_account_link(link_id)
        if not link:
            return (jsonify({'error': 'Заявка не найдена'}), 404)
        if user['id'] not in (link['initiator_user_id'], link['other_user_id']):
            return (jsonify({'error': 'Нет доступа'}), 403)
        return _finalize_merge(link, otp_code=code, skip_otp=False)

    def _finalize_merge(link: dict, otp_code: str | None, skip_otp: bool):
        if not skip_otp:
            email = _norm_email(link.get('link_email') or '')
            if not email:
                return (jsonify({'error': 'Нет email для подтверждения'}), 400)
            ok, _, err = database.verify_email_otp(email, 'merge', otp_code or '')
            if not ok:
                return (jsonify({'error': err or 'Неверный код'}), 400)

        primary_id = link.get('chosen_primary_user_id') or link['initiator_user_id']
        secondary_id = link['other_user_id'] if primary_id == link['initiator_user_id'] else link['initiator_user_id']
        ok, msg = account_link.merge_accounts(primary_id, secondary_id)
        if not ok:
            return (jsonify({'error': msg or 'Не удалось объединить аккаунты'}), 500)

        if link.get('link_email'):
            database.set_user_email(primary_id, email=_norm_email(link['link_email']), verified=True)
        if link.get('link_telegram_id'):
            try:
                database.set_user_telegram_id(primary_id, telegram_id=int(link['link_telegram_id']))
            except Exception:
                pass

        database.update_pending_account_link(link['id'], status='done')
        primary = database.get_user_by_id(primary_id)
        token = _session_for_user(primary)
        return jsonify({
            'success': True,
            'session_token': token,
            'user_id': primary['id'],
            'telegram_id': primary.get('telegram_id'),
            'email': primary.get('email'),
            'username': primary.get('username'),
            'first_name': primary.get('full_name'),
            'pending_link': None,
        })
