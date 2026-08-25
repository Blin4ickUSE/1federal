"""Outbound email via project SMTP (docker mail service)."""
import logging
import os
import smtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv('SMTP_HOST', 'mail')
SMTP_PORT = int(os.getenv('SMTP_PORT', '25') or 25)
SMTP_USER = os.getenv('SMTP_USER', '')
SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '')
MAIL_DOMAIN = os.getenv('MAIL_DOMAIN') or os.getenv('MINIAPP_DOMAIN') or 'localhost'
MAIL_FROM = os.getenv('MAIL_FROM') or f'no-reply@{MAIL_DOMAIN}'


def send_email(to_email: str, subject: str, body: str) -> bool:
    to_email = (to_email or '').strip()
    if not to_email:
        return False
    msg = EmailMessage()
    msg['From'] = MAIL_FROM
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
            smtp.ehlo()
            if SMTP_USER and SMTP_PASSWORD:
                try:
                    smtp.starttls()
                except smtplib.SMTPException:
                    pass
                smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(msg)
        logger.info('Email sent to %s subject=%s', to_email, subject)
        return True
    except Exception as e:
        logger.error('Failed to send email to %s: %s', to_email, e)
        return False


def send_otp_email(to_email: str, code: str, purpose: str='verify') -> bool:
    purpose_labels = {
        'register': 'регистрации',
        'login': 'входа',
        'link': 'привязки почты',
        'change': 'смены почты',
        'unlink': 'отвязки почты',
        'merge': 'подтверждения объединения аккаунтов',
    }
    label = purpose_labels.get(purpose, 'подтверждения')
    subject = f'Код {label} — 1FEDERAL VPN'
    body = (
        f'Ваш код {label}: {code}\n\n'
        f'Код действует 10 минут.\n'
        f'Если вы не запрашивали это письмо — просто проигнорируйте его.\n'
    )
    return send_email(to_email, subject, body)
