
import logging
import os
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

PLATEGA_API_URL = os.getenv('PLATEGA_API_URL', 'https://app.platega.io').rstrip('/')
PLATEGA_MERCHANT_ID = os.getenv('PLATEGA_MERCHANT_ID', '')
PLATEGA_SECRET_KEY = os.getenv('PLATEGA_SECRET_KEY', '')

PAYMENT_METHOD_SBP = 2
PAYMENT_METHOD_CARD = 11
PAYMENT_METHOD_SUBSCRIPTION = 6

# Platega recurring intervals: 1 day, 2 week, 3 month, 4 year
SUBSCRIPTION_INTERVAL_DAY = 1
SUBSCRIPTION_INTERVAL_WEEK = 2
SUBSCRIPTION_INTERVAL_MONTH = 3
SUBSCRIPTION_INTERVAL_YEAR = 4

PLATEGA_SUCCESS_STATUSES = {'CONFIRMED', 'confirmed'}
PLATEGA_SUBSCRIPTION_STATUSES = {
    'SUBSCRIPTION_ACTIVATED',
    'SUBSCRIPTION_PAST_DUE',
    'SUBSCRIPTION_CANCELLED',
    'SUBSCRIPTION_FAILED',
}


class PlategaAPI:
    def __init__(self):
        self.merchant_id = PLATEGA_MERCHANT_ID
        self.secret_key = PLATEGA_SECRET_KEY
        self.api_url = PLATEGA_API_URL

    def reload_from_env(self):
        self.merchant_id = os.getenv('PLATEGA_MERCHANT_ID', '')
        self.secret_key = os.getenv('PLATEGA_SECRET_KEY', '')
        self.api_url = os.getenv('PLATEGA_API_URL', 'https://app.platega.io').rstrip('/')

    @property
    def is_configured(self) -> bool:
        return bool(self.merchant_id and self.secret_key)

    def _headers(self) -> Dict[str, str]:
        return {
            'X-MerchantId': self.merchant_id,
            'X-Secret': self.secret_key,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

    def create_payment(
        self,
        amount: float,
        user_id: int,
        payment_method: int,
        return_url: Optional[str] = None,
        failed_url: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not self.is_configured:
            return {'ok': False, 'error': 'Platega is not configured'}

        miniapp_url = os.getenv('MINIAPP_URL', '')
        return_url = return_url or (f'{miniapp_url}/success' if miniapp_url else 'https://example.com/success')
        failed_url = failed_url or (f'{miniapp_url}/failed' if miniapp_url else 'https://example.com/failed')

        payload = {
            'paymentMethod': int(payment_method),
            'paymentDetails': {
                'amount': round(float(amount), 2),
                'currency': 'RUB',
            },
            'description': description or f'Оплата подписки пользователя #{user_id}',
            'return': return_url,
            'failedUrl': failed_url,
            'payload': str(user_id),
        }

        url = f'{self.api_url}/transaction/process'
        try:
            response = requests.post(url, headers=self._headers(), json=payload, timeout=30)
            parsed: Optional[Dict[str, Any]] = None
            if response.content:
                try:
                    parsed = response.json()
                except Exception:
                    parsed = None

            if not response.ok:
                logger.error('Platega error %s: %s', response.status_code, (response.text or '')[:1000])
                return {
                    'ok': False,
                    'provider': 'platega',
                    'status_code': response.status_code,
                    'error': 'Platega request failed',
                    'response': parsed,
                    'raw': response.text,
                }

            if not isinstance(parsed, dict):
                return {'ok': False, 'provider': 'platega', 'error': 'unexpected response', 'response': parsed}

            transaction_id = parsed.get('transactionId') or parsed.get('id')
            redirect_url = parsed.get('redirect') or parsed.get('paymentUrl') or parsed.get('url')
            if not transaction_id or not redirect_url:
                return {'ok': False, 'provider': 'platega', 'error': 'unexpected response', 'response': parsed}

            logger.info(
                'Platega invoice created: %s user=%s amount=%s method=%s',
                transaction_id, user_id, amount, payment_method,
            )
            return {
                'ok': True,
                'id': str(transaction_id),
                'redirect_url': str(redirect_url),
                'status': str(parsed.get('status', 'PENDING')).lower(),
                'amount': round(float(amount), 2),
                'payment_method': payment_method,
            }
        except requests.exceptions.RequestException as exc:
            logger.error('Platega API error: %s', exc)
            return {'ok': False, 'error': str(exc)}

    def create_sbp_payment(
        self,
        amount: float,
        user_id: int,
        return_url: Optional[str] = None,
        failed_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self.create_payment(
            amount, user_id, PAYMENT_METHOD_SBP,
            return_url=return_url, failed_url=failed_url,
            description=f'Оплата через СБП (пользователь #{user_id})',
        )

    def create_card_payment(
        self,
        amount: float,
        user_id: int,
        return_url: Optional[str] = None,
        failed_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self.create_payment(
            amount, user_id, PAYMENT_METHOD_CARD,
            return_url=return_url, failed_url=failed_url,
            description=f'Оплата картой (пользователь #{user_id})',
        )

    def create_recurring_subscription(
        self,
        amount: float,
        user_id: int,
        interval: int = SUBSCRIPTION_INTERVAL_MONTH,
        description: Optional[str] = None,
        return_url: Optional[str] = None,
        failed_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Создать рекуррентную СБП-подписку (paymentMethod=6). transactionId = subscriptionId."""
        if not self.is_configured:
            return {'ok': False, 'error': 'Platega is not configured'}

        miniapp_url = os.getenv('MINIAPP_URL', '')
        return_url = return_url or (f'{miniapp_url}/success' if miniapp_url else 'https://example.com/success')
        failed_url = failed_url or (f'{miniapp_url}/failed' if miniapp_url else 'https://example.com/failed')

        amount_int = int(round(float(amount)))
        if amount_int <= 0:
            return {'ok': False, 'error': 'Invalid subscription amount'}

        payload = {
            'paymentMethod': PAYMENT_METHOD_SUBSCRIPTION,
            'paymentDetails': {
                'amount': amount_int,
                'currency': 'RUB',
                'interval': int(interval),
            },
            'description': description or f'Автопродление подписки (пользователь #{user_id})',
            'return': return_url,
            'failedUrl': failed_url,
            'payload': str(user_id),
        }

        url = f'{self.api_url}/transaction/process'
        try:
            response = requests.post(url, headers=self._headers(), json=payload, timeout=30)
            parsed: Optional[Dict[str, Any]] = None
            if response.content:
                try:
                    parsed = response.json()
                except Exception:
                    parsed = None

            if not response.ok:
                logger.error('Platega subscription error %s: %s', response.status_code, (response.text or '')[:1000])
                return {
                    'ok': False,
                    'provider': 'platega',
                    'status_code': response.status_code,
                    'error': 'Platega subscription request failed',
                    'response': parsed,
                    'raw': response.text,
                }

            if not isinstance(parsed, dict):
                return {'ok': False, 'provider': 'platega', 'error': 'unexpected response', 'response': parsed}

            subscription_id = parsed.get('transactionId') or parsed.get('id')
            redirect_url = parsed.get('redirect') or parsed.get('paymentUrl') or parsed.get('url')
            if not subscription_id or not redirect_url:
                return {'ok': False, 'provider': 'platega', 'error': 'unexpected response', 'response': parsed}

            logger.info(
                'Platega subscription created: %s user=%s amount=%s interval=%s',
                subscription_id, user_id, amount_int, interval,
            )
            return {
                'ok': True,
                'id': str(subscription_id),
                'redirect_url': str(redirect_url),
                'status': str(parsed.get('status', 'PENDING')).lower(),
                'amount': amount_int,
                'payment_method': PAYMENT_METHOD_SUBSCRIPTION,
                'recurring': True,
            }
        except requests.exceptions.RequestException as exc:
            logger.error('Platega subscription API error: %s', exc)
            return {'ok': False, 'error': str(exc)}

    def get_subscription(self, subscription_id: str) -> Optional[Dict[str, Any]]:
        if not self.is_configured or not subscription_id:
            return None
        url = f'{self.api_url}/subscription/{subscription_id}'
        try:
            response = requests.get(url, headers=self._headers(), timeout=20)
            if not response.ok:
                logger.error('Platega get_subscription %s: %s', response.status_code, (response.text or '')[:500])
                return None
            data = response.json()
            return data if isinstance(data, dict) else None
        except Exception as exc:
            logger.error('Platega get_subscription error: %s', exc)
            return None

    def cancel_subscription(self, subscription_id: str) -> Dict[str, Any]:
        if not self.is_configured or not subscription_id:
            return {'ok': False, 'error': 'Platega is not configured'}
        url = f'{self.api_url}/subscription/{subscription_id}/cancel'
        try:
            response = requests.post(url, headers=self._headers(), timeout=20)
            parsed: Optional[Dict[str, Any]] = None
            if response.content:
                try:
                    parsed = response.json()
                except Exception:
                    parsed = None
            if not response.ok:
                logger.error('Platega cancel_subscription %s: %s', response.status_code, (response.text or '')[:500])
                return {
                    'ok': False,
                    'status_code': response.status_code,
                    'error': 'Cancel failed',
                    'response': parsed,
                }
            return {
                'ok': True,
                'subscription_id': str((parsed or {}).get('subscriptionId') or subscription_id),
                'status': str((parsed or {}).get('status') or 'cancelled'),
            }
        except Exception as exc:
            logger.error('Platega cancel_subscription error: %s', exc)
            return {'ok': False, 'error': str(exc)}

    def get_transaction(self, transaction_id: str) -> Optional[Dict[str, Any]]:
        if not self.is_configured or not transaction_id:
            return None
        url = f'{self.api_url}/transaction/{transaction_id}'
        try:
            response = requests.get(url, headers=self._headers(), timeout=20)
            if not response.ok:
                logger.error('Platega get_transaction %s: %s', response.status_code, (response.text or '')[:500])
                return None
            data = response.json()
            return data if isinstance(data, dict) else None
        except Exception as exc:
            logger.error('Platega get_transaction error: %s', exc)
            return None

    def verify_webhook(self, merchant_id: str = '', secret: str = '') -> bool:
        if not self.is_configured:
            logger.warning('Platega is not configured, webhook accepted without auth')
            return True
        mid = (merchant_id or '').strip()
        sec = (secret or '').strip()
        return mid == self.merchant_id and sec == self.secret_key

    @staticmethod
    def extract_user_id(payload: Any = None, transaction: Optional[Dict[str, Any]] = None) -> Optional[int]:
        candidates = []
        if payload is not None:
            candidates.append(payload)
        if isinstance(transaction, dict):
            candidates.append(transaction.get('payload'))
            candidates.append(transaction.get('Payload'))
        for value in candidates:
            if value is None:
                continue
            text = str(value).strip()
            if text.isdigit():
                return int(text)
            if text.startswith('user:') and text[5:].isdigit():
                return int(text[5:])
        return None

    @staticmethod
    def method_name_from_code(payment_method: Any) -> str:
        try:
            code = int(payment_method)
        except (TypeError, ValueError):
            return 'Platega'
        if code == PAYMENT_METHOD_SBP:
            return 'СБП'
        if code == PAYMENT_METHOD_SUBSCRIPTION:
            return 'СБП подписка'
        if code in (PAYMENT_METHOD_CARD, 10, 12):
            return 'Карта'
        if code == 13:
            return 'Crypto'
        return 'Platega'

    @staticmethod
    def interval_for_days(days: int) -> Optional[int]:
        if days in (30, 31):
            return SUBSCRIPTION_INTERVAL_MONTH
        if days in (365, 366):
            return SUBSCRIPTION_INTERVAL_YEAR
        return None


platega_api = PlategaAPI()
