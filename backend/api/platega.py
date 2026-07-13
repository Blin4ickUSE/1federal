import os
import requests
import logging
import uuid
from typing import Optional, Dict, Any
logger = logging.getLogger(__name__)
PLATEGA_API_URL = os.getenv('PLATEGA_API_URL', 'https://app.platega.io')
PLATEGA_MERCHANT_ID = os.getenv('PLATEGA_MERCHANT_ID', '')
PLATEGA_SECRET_KEY = os.getenv('PLATEGA_SECRET_KEY', '')
PLATEGA_RETURN_URL = os.getenv('PLATEGA_RETURN_URL', '')
PLATEGA_FAILED_URL = os.getenv('PLATEGA_FAILED_URL', '')
PLATEGA_METHOD_SBP_QR = 2
PLATEGA_METHOD_ERIP = 3
PLATEGA_METHOD_CARD = 11
PLATEGA_METHOD_INTL = 12
PLATEGA_METHOD_CRYPTO = 13
PLATEGA_SUCCESS_STATUSES = {'CONFIRMED'}
PLATEGA_FAILED_STATUSES = {'CANCELED', 'CHARGEBACKED'}
PLATEGA_PENDING_STATUSES = {'PENDING'}

class PlategaAPI:
    def __init__(self):
        self.base_url = PLATEGA_API_URL.rstrip('/')
        self.merchant_id = PLATEGA_MERCHANT_ID
        self.secret_key = PLATEGA_SECRET_KEY
        self.return_url = PLATEGA_RETURN_URL
        self.failed_url = PLATEGA_FAILED_URL
    @property
    def is_configured(self) -> bool:
        return bool(self.merchant_id and self.secret_key)
    def _request(self, method: str, endpoint: str, data: Dict=None) -> Optional[Dict]:
        if not self.is_configured:
            logger.error('Platega не настроен')
            return {'ok': False, 'status_code': None, 'error': 'Platega is not configured'}
        url = f'{self.base_url}{endpoint}'
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json', 'X-MerchantId': self.merchant_id, 'X-Secret': self.secret_key}
        try:
            logger.info(f'Platega request: {method} {url}')
            if method == 'POST':
                response = requests.post(url, headers=headers, json=data, timeout=30)
            elif method == 'GET':
                response = requests.get(url, headers=headers, params=data, timeout=30)
            else:
                raise ValueError(f'unsupported method: {method}')
            logger.info(f'platega response: {response.status_code}')
            parsed: Optional[Dict[str, Any]] = None
            if response.content:
                try:
                    parsed = response.json()
                except Exception:
                    parsed = None
            if not response.ok:
                try:
                    logger.error('platega error body: %s', (response.text or '')[:1000])
                except Exception:
                    pass
                return {'ok': False, 'status_code': response.status_code, 'error': 'Platega request failed', 'response': parsed, 'raw': response.text}
            return parsed
        except requests.exceptions.RequestException as e:
            logger.error(f'Platega API error: {e}')
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f'Response: {e.response.text}')
            return {'ok': False, 'status_code': getattr(getattr(e, 'response', None), 'status_code', None), 'error': str(e)}
    def create_payment(self, amount: float, user_id: int, description: str=None, payment_method: int=PLATEGA_METHOD_SBP_QR, return_url: str=None, failed_url: str=None) -> Optional[Dict]:
        if not self.is_configured:
            return {'ok': False, 'error': 'Platega is not configured'}
        correlation_id = f'platega_{user_id}_{uuid.uuid4().hex[:8]}'
        return_url = return_url or self.return_url
        failed_url = failed_url or self.failed_url
        if not return_url or not failed_url:
            miniapp_url = os.getenv('MINIAPP_URL', '')
            if miniapp_url:
                return_url = return_url or f'{miniapp_url}/success'
                failed_url = failed_url or f'{miniapp_url}/failed'
        data = {'paymentMethod': payment_method, 'paymentDetails': {'amount': float(amount), 'currency': 'RUB'}, 'description': description or f'Пополнение баланса', 'return': return_url, 'failedUrl': failed_url, 'payload': correlation_id}
        endpoints = ['/transaction/process', '/transaction/process/', '/api/transaction/process', '/api/transaction/process/']
        result = None
        for ep in endpoints:
            result = self._request('POST', ep, data)
            if not (isinstance(result, dict) and result.get('ok') is False and (result.get('status_code') == 404)):
                break
        if isinstance(result, dict) and result.get('ok') is False:
            return {'ok': False, 'provider': 'platega', 'details': result}
        if not result:
            return {'ok': False, 'provider': 'platega', 'error': 'Empty response'}
        transaction_id = result.get('transactionId')
        redirect_url = result.get('redirect')
        status = str(result.get('status', 'PENDING')).upper()
        if not transaction_id or not redirect_url:
            return {'ok': False, 'provider': 'platega', 'error': 'unexpected response', 'response': result}
        logger.info(f'platega payment create: {transaction_id}, {user_id}, {amount}₽')
        return {'ok': True, 'id': transaction_id, 'redirect_url': redirect_url, 'status': status, 'correlation_id': correlation_id, 'payload': correlation_id, 'amount': amount, 'amount_kopeks': int(amount * 100), 'expires_in': result.get('expiresIn')}
    def create_sbp_payment(self, amount: float, user_id: int, description: str=None, return_url: str=None, failed_url: str=None) -> Optional[Dict]:
        return self.create_payment(amount, user_id, description, PLATEGA_METHOD_SBP_QR, return_url=return_url, failed_url=failed_url)
    def create_card_payment(self, amount: float, user_id: int, description: str=None, return_url: str=None, failed_url: str=None) -> Optional[Dict]:
        return self.create_payment(amount, user_id, description, PLATEGA_METHOD_CARD, return_url=return_url, failed_url=failed_url)
    def verify_webhook(self, headers: Dict, payload: Dict) -> bool:
        if not self.is_configured:
            return True
        received_merchant = headers.get('X-MerchantId', '')
        received_secret = headers.get('X-Secret', '')
        return received_merchant == self.merchant_id and received_secret == self.secret_key
    def verify_webhook_signature(self, payload: Dict, signature: str=None) -> bool:
        return True
platega_api = PlategaAPI()
