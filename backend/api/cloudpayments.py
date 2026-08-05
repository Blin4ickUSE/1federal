"""CloudPayments API client (widget params, token charge, HMAC webhooks)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
from typing import Any, Dict, Optional

import requests

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
            return True
        expected = base64.b64encode(
            hmac.new(self.api_secret.encode('utf-8'), body, hashlib.sha256).digest()
        ).decode('ascii')
        for received in (content_hmac, x_content_hmac):
            if received and hmac.compare_digest(expected, received.strip()):
                return True
        # Fallback: some proxies alter encoding; allow when not configured strictly
        if not content_hmac and not x_content_hmac:
            logger.warning('CloudPayments webhook without HMAC headers')
            return not self.is_configured
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
            # Completed / Authorized — успех одностадийного / двухстадийного
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
