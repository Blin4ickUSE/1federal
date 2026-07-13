import hashlib
import hmac
import json
import logging
import os
import uuid
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

LAVA_API_URL = os.getenv('LAVA_API_URL', 'https://api.lava.ru').rstrip('/')
LAVA_SHOP_ID = os.getenv('LAVA_SHOP_ID', '')
LAVA_SECRET_KEY = os.getenv('LAVA_SECRET_KEY', '')
LAVA_SECRET_KEY_2 = os.getenv('LAVA_SECRET_KEY_2', '')
LAVA_HOOK_URL = os.getenv('LAVA_HOOK_URL', '')
LAVA_SUCCESS_STATUSES = {'success', 'paid'}


class LavaAPI:
    def __init__(self):
        self.shop_id = LAVA_SHOP_ID
        self.secret_key = LAVA_SECRET_KEY
        self.secret_key_2 = LAVA_SECRET_KEY_2
        self.hook_url = LAVA_HOOK_URL

    @property
    def is_configured(self) -> bool:
        return bool(self.shop_id and self.secret_key)

    def _sign_payload(self, payload: Dict[str, Any]) -> str:
        body = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
        return hmac.new(self.secret_key.encode(), body.encode(), hashlib.sha256).hexdigest()

    def _request_invoice(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.is_configured:
            return {'ok': False, 'error': 'Lava is not configured'}

        signature = self._sign_payload(payload)
        headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Signature': signature,
        }
        url = f'{LAVA_API_URL}/business/invoice/create'
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=30)
            parsed: Optional[Dict[str, Any]] = None
            if response.content:
                try:
                    parsed = response.json()
                except Exception:
                    parsed = None
            if not response.ok:
                logger.error('Lava error %s: %s', response.status_code, (response.text or '')[:1000])
                return {
                    'ok': False,
                    'status_code': response.status_code,
                    'error': 'Lava request failed',
                    'response': parsed,
                    'raw': response.text,
                }
            data = parsed.get('data') if isinstance(parsed, dict) else None
            if not isinstance(data, dict):
                data = parsed if isinstance(parsed, dict) else {}
            invoice_id = data.get('id') or data.get('invoice_id')
            payment_url = data.get('url') or data.get('payment_url')
            if not invoice_id or not payment_url:
                return {'ok': False, 'provider': 'lava', 'error': 'unexpected response', 'response': parsed}
            return {
                'ok': True,
                'id': invoice_id,
                'redirect_url': payment_url,
                'status': str(data.get('status', 'pending')).lower(),
                'order_id': payload.get('orderId'),
                'amount': payload.get('sum'),
            }
        except requests.exceptions.RequestException as exc:
            logger.error('Lava API error: %s', exc)
            return {'ok': False, 'error': str(exc)}

    def create_payment(
        self,
        amount: float,
        user_id: int,
        services: list[str],
        return_url: Optional[str] = None,
        failed_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        miniapp_url = os.getenv('MINIAPP_URL', '')
        return_url = return_url or (f'{miniapp_url}/success' if miniapp_url else None)
        failed_url = failed_url or (f'{miniapp_url}/failed' if miniapp_url else None)
        hook_url = self.hook_url or os.getenv('WEBHOOK_URL', '')
        if hook_url and not hook_url.endswith('/lava'):
            hook_url = hook_url.rstrip('/') + '/lava'

        order_id = f'lava_{user_id}_{uuid.uuid4().hex[:12]}'
        payload: Dict[str, Any] = {
            'shopId': self.shop_id,
            'sum': round(float(amount), 2),
            'orderId': order_id,
            'comment': f'Пополнение баланса пользователя #{user_id}',
            'customFields': str(user_id),
            'expire': 300,
        }
        if hook_url:
            payload['hookUrl'] = hook_url
        if return_url:
            payload['successUrl'] = return_url
        if failed_url:
            payload['failUrl'] = failed_url
        if services:
            payload['includeService'] = services

        result = self._request_invoice(payload)
        if result.get('ok'):
            logger.info('Lava invoice created: %s user=%s amount=%s', result.get('id'), user_id, amount)
        return result

    def create_sbp_payment(
        self,
        amount: float,
        user_id: int,
        return_url: Optional[str] = None,
        failed_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self.create_payment(amount, user_id, ['sbp'], return_url=return_url, failed_url=failed_url)

    def create_card_payment(
        self,
        amount: float,
        user_id: int,
        return_url: Optional[str] = None,
        failed_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self.create_payment(amount, user_id, ['card'], return_url=return_url, failed_url=failed_url)

    def verify_webhook(self, raw_body: bytes, authorization: str = '') -> bool:
        if not self.secret_key_2:
            logger.warning('LAVA_SECRET_KEY_2 is not set, webhook signature not verified')
            return True
        expected = hmac.new(self.secret_key_2.encode(), raw_body, hashlib.sha256).hexdigest()
        received = (authorization or '').strip()
        if not received:
            return False
        return hmac.compare_digest(expected, received)

    @staticmethod
    def extract_user_id(order_id: str, custom_fields: Any = None) -> Optional[int]:
        if custom_fields is not None and str(custom_fields).strip().isdigit():
            return int(str(custom_fields).strip())
        parts = str(order_id or '').split('_')
        if len(parts) >= 2 and parts[0] == 'lava':
            try:
                return int(parts[1])
            except ValueError:
                return None
        return None


lava_api = LavaAPI()
