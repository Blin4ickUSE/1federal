import os
import asyncio
import json
import ssl
import base64
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Union, Any
import aiohttp
import logging
from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlparse, urljoin
logger = logging.getLogger(__name__)

class UserStatus(Enum):
    ACTIVE = 'ACTIVE'
    DISABLED = 'DISABLED'
    LIMITED = 'LIMITED'
    EXPIRED = 'EXPIRED'

class TrafficLimitStrategy(Enum):
    NO_RESET = 'NO_RESET'
    DAY = 'DAY'
    WEEK = 'WEEK'
    MONTH = 'MONTH'
    MONTH_ROLLING = 'MONTH_ROLLING'

@dataclass

class UserTraffic:
    used_traffic_bytes: int
    lifetime_used_traffic_bytes: int
    online_at: Optional[datetime] = None
    first_connected_at: Optional[datetime] = None
    last_connected_node_uuid: Optional[str] = None

@dataclass

class RemnaWaveUser:
    uuid: str
    short_uuid: str
    username: str
    status: UserStatus
    traffic_limit_bytes: int
    traffic_limit_strategy: TrafficLimitStrategy
    expire_at: datetime
    telegram_id: Optional[int]
    email: Optional[str]
    hwid_device_limit: Optional[int]
    description: Optional[str]
    tag: Optional[str]
    subscription_url: str
    active_internal_squads: List[Dict[str, str]]
    created_at: datetime
    updated_at: datetime
    user_traffic: Optional[UserTraffic] = None
    sub_last_user_agent: Optional[str] = None
    sub_last_opened_at: Optional[datetime] = None
    sub_revoked_at: Optional[datetime] = None
    last_traffic_reset_at: Optional[datetime] = None
    trojan_password: Optional[str] = None
    vless_uuid: Optional[str] = None
    ss_password: Optional[str] = None
    last_triggered_threshold: int = 0
    happ_link: Optional[str] = None
    happ_crypto_link: Optional[str] = None
    external_squad_uuid: Optional[str] = None
    id: Optional[int] = None
    @property
    def used_traffic_bytes(self) -> int:
        if self.user_traffic:
            return self.user_traffic.used_traffic_bytes
        return 0
    @property
    def lifetime_used_traffic_bytes(self) -> int:
        if self.user_traffic:
            return self.user_traffic.lifetime_used_traffic_bytes
        return 0

@dataclass

class RemnaWaveInternalSquad:
    uuid: str
    name: str
    members_count: int
    inbounds_count: int
    inbounds: List[Dict]
    view_position: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class RemnaWaveAPIError(Exception):
    def __init__(self, message: str, status_code: int=None, response_data: dict=None):
        self.message = message
        self.status_code = status_code
        self.response_data = response_data
        super().__init__(self.message)

class RemnaWaveAPI:
    def __init__(self, base_url: str, api_key: str, secret_key: Optional[str]=None, username: Optional[str]=None, password: Optional[str]=None, caddy_token: Optional[str]=None, auth_type: str='api_key'):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.secret_key = secret_key
        self.username = username
        self.password = password
        self.caddy_token = caddy_token
        self.auth_type = auth_type.lower() if auth_type else 'api_key'
        self.session: Optional[aiohttp.ClientSession] = None
        self.authenticated = False
    def _detect_connection_type(self) -> str:
        parsed = urlparse(self.base_url)
        local_hosts = ['localhost', '127.0.0.1', 'remnawave', 'remnawave-backend', 'app', 'api']
        if parsed.hostname in local_hosts:
            return 'local'
        if parsed.hostname:
            if parsed.hostname.startswith('192.168.') or parsed.hostname.startswith('10.') or parsed.hostname.startswith('172.') or parsed.hostname.endswith('.local'):
                return 'local'
        return 'external'
    def _prepare_auth_headers(self) -> Dict[str, str]:
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '127.0.0.1'}
        if self.caddy_token:
            headers['Authorization'] = f'Basic {self.caddy_token}'
            logger.debug('Используем Caddy Basic Auth')
        if self.auth_type == 'basic' and self.username and self.password:
            credentials = f'{self.username}:{self.password}'
            encoded_credentials = base64.b64encode(credentials.encode()).decode()
            headers['X-Api-Key'] = f'Basic {encoded_credentials}'
            logger.debug('Используем Basic Auth в X-Api-Key заголовке')
        elif self.auth_type == 'caddy':
            if self.api_key:
                headers['X-Api-Key'] = self.api_key
                logger.debug('Используем API ключ для RemnaWave + Caddy авторизацию')
        else:
            headers['X-Api-Key'] = self.api_key
            if not self.caddy_token:
                headers['Authorization'] = f'Bearer {self.api_key}'
            logger.debug('Используем API ключ в X-Api-Key заголовке')
        return headers
    async def __aenter__(self):
        conn_type = self._detect_connection_type()
        logger.debug(f'Подключение к Remnawave: {self.base_url} (тип: {conn_type})')
        headers = self._prepare_auth_headers()
        cookies = None
        if self.secret_key:
            if ':' in self.secret_key:
                key_name, key_value = self.secret_key.split(':', 1)
                cookies = {key_name: key_value}
                logger.debug(f'Используем куки: {key_name}=***')
            else:
                cookies = {self.secret_key: self.secret_key}
                logger.debug(f'Используем куки: {self.secret_key}=***')
        connector_kwargs = {}
        if conn_type == 'local':
            logger.debug('Используют локальные заголовки proxy')
            headers.update({'X-Forwarded-Host': 'localhost', 'Host': 'localhost'})
            if self.base_url.startswith('https://'):
                ssl_context = ssl.create_default_context()
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
                connector_kwargs['ssl'] = ssl_context
                logger.debug('SSL проверка отключена для локального HTTPS')
        elif conn_type == 'external':
            logger.debug('Используют внешнее подключение с полной SSL проверкой')
            pass
        connector = aiohttp.TCPConnector(**connector_kwargs)
        session_kwargs = {'timeout': aiohttp.ClientTimeout(total=30), 'headers': headers, 'connector': connector}
        if cookies:
            session_kwargs['cookies'] = cookies
        self.session = aiohttp.ClientSession(**session_kwargs)
        self.authenticated = True
        return self
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    async def _make_request(self, method: str, endpoint: str, data: Optional[Dict]=None, params: Optional[Dict]=None) -> Dict:
        if not self.session:
            raise RemnaWaveAPIError('Session not initialized. Use async context manager.')
        url = f'{self.base_url}{endpoint}'
        try:
            kwargs = {'url': url, 'params': params}
            if data:
                kwargs['json'] = data
            async with self.session.request(method, **kwargs) as response:
                response_text = await response.text()
                try:
                    response_data = json.loads(response_text) if response_text else {}
                except json.JSONDecodeError:
                    response_data = {'raw_response': response_text}
                if response.status >= 400:
                    error_message = response_data.get('message', f'HTTP {response.status}')
                    logger.error(f'API Error {response.status}: {error_message}')
                    logger.error(f'Response: {response_text[:500]}')
                    raise RemnaWaveAPIError(error_message, response.status, response_data)
                return response_data
        except aiohttp.ClientError as e:
            logger.error(f'Request failed: {e}')
            raise RemnaWaveAPIError(f'Request failed: {str(e)}')
    async def get_internal_squads(self) -> List[RemnaWaveInternalSquad]:
        response = await self._make_request('GET', '/api/internal-squads')
        squads_data = response.get('response', {}).get('internalSquads', [])
        return [self._parse_internal_squad(squad) for squad in squads_data]
    async def get_user_by_telegram_id(self, telegram_id: int) -> List[RemnaWaveUser]:
        try:
            response = await self._make_request('GET', f'/api/users/by-telegram-id/{telegram_id}')
            users_data = response.get('response', [])
            if not users_data:
                return []
            users = [self._parse_user(user) for user in users_data]
            return users
        except RemnaWaveAPIError as e:
            if e.status_code == 404:
                return []
            raise
    async def create_user(self, username: str, expire_at: datetime, status: UserStatus=UserStatus.ACTIVE, traffic_limit_bytes: int=0, traffic_limit_strategy: TrafficLimitStrategy=TrafficLimitStrategy.NO_RESET, telegram_id: Optional[int]=None, email: Optional[str]=None, hwid_device_limit: Optional[int]=None, description: Optional[str]=None, tag: Optional[str]=None, active_internal_squads: Optional[List[str]]=None) -> RemnaWaveUser:
        data = {'username': username, 'status': status.value, 'expireAt': expire_at.isoformat(), 'trafficLimitBytes': traffic_limit_bytes, 'trafficLimitStrategy': traffic_limit_strategy.value}
        if telegram_id:
            data['telegramId'] = telegram_id
        if email:
            data['email'] = email
        if hwid_device_limit:
            data['hwidDeviceLimit'] = hwid_device_limit
        if description:
            data['description'] = description
        if tag:
            data['tag'] = tag
        if active_internal_squads:
            data['activeInternalSquads'] = active_internal_squads
        logger.info('Создание пользователя в Remnawave: %s', data)
        response = await self._make_request('POST', '/api/users', data)
        user = self._parse_user(response['response'])
        return user
    async def update_user(self, uuid: str, status: Optional[UserStatus]=None, traffic_limit_bytes: Optional[int]=None, traffic_limit_strategy: Optional[TrafficLimitStrategy]=None, expire_at: Optional[datetime]=None, telegram_id: Optional[int]=None, email: Optional[str]=None, hwid_device_limit: Optional[int]=None, description: Optional[str]=None, tag: Optional[str]=None, active_internal_squads: Optional[List[str]]=None) -> RemnaWaveUser:
        data = {'uuid': uuid}
        if status:
            data['status'] = status.value
        if traffic_limit_bytes is not None:
            data['trafficLimitBytes'] = traffic_limit_bytes
        if traffic_limit_strategy:
            data['trafficLimitStrategy'] = traffic_limit_strategy.value
        if expire_at:
            data['expireAt'] = expire_at.isoformat()
        if telegram_id is not None:
            data['telegramId'] = telegram_id
        if email is not None:
            data['email'] = email
        if hwid_device_limit is not None:
            data['hwidDeviceLimit'] = hwid_device_limit
        if description is not None:
            data['description'] = description
        if tag is not None:
            data['tag'] = tag
        if active_internal_squads is not None:
            data['activeInternalSquads'] = active_internal_squads
        response = await self._make_request('PATCH', '/api/users', data)
        user = self._parse_user(response['response'])
        return user
    async def delete_user(self, uuid: str) -> bool:
        try:
            response = await self._make_request('DELETE', f'/api/users/{uuid}')
            return response.get('response', {}).get('isDeleted', False)
        except Exception as e:
            logger.error(f'Error deleting user {uuid}: {e}')
            return False
    async def get_all_users(self, start: int=0, size: int=100) -> Dict[str, Any]:
        params = {'start': start, 'size': size}
        response = await self._make_request('GET', '/api/users', params=params)
        users = [self._parse_user(user) for user in response['response']['users']]
        return {'users': users, 'total': response['response']['total']}
    def _parse_user(self, user_data: Dict) -> RemnaWaveUser:
        status_str = user_data.get('status') or 'ACTIVE'
        try:
            status = UserStatus(status_str)
        except ValueError:
            logger.warning(f'Неизвестный статус пользователя: {status_str}, используем ACTIVE')
            status = UserStatus.ACTIVE
        strategy_str = user_data.get('trafficLimitStrategy') or 'NO_RESET'
        try:
            traffic_strategy = TrafficLimitStrategy(strategy_str)
        except ValueError:
            logger.warning(f'Неизвестная стратегия трафика: {strategy_str}, используем NO_RESET')
            traffic_strategy = TrafficLimitStrategy.NO_RESET
        return RemnaWaveUser(uuid=user_data['uuid'], short_uuid=user_data['shortUuid'], username=user_data['username'], status=status, traffic_limit_bytes=user_data.get('trafficLimitBytes', 0), traffic_limit_strategy=traffic_strategy, expire_at=datetime.fromisoformat(user_data['expireAt'].replace('Z', '+00:00')), telegram_id=user_data.get('telegramId'), email=user_data.get('email'), hwid_device_limit=user_data.get('hwidDeviceLimit'), description=user_data.get('description'), tag=user_data.get('tag'), subscription_url=user_data.get('subscriptionUrl', ''), active_internal_squads=user_data.get('activeInternalSquads', []), created_at=datetime.fromisoformat(user_data['createdAt'].replace('Z', '+00:00')), updated_at=datetime.fromisoformat(user_data['updatedAt'].replace('Z', '+00:00')), user_traffic=self._parse_user_traffic(user_data.get('userTraffic')))
    def _parse_user_traffic(self, traffic_data: Optional[Dict]) -> Optional[UserTraffic]:
        if not traffic_data:
            return None
        return UserTraffic(used_traffic_bytes=int(traffic_data.get('usedTrafficBytes', 0)), lifetime_used_traffic_bytes=int(traffic_data.get('lifetimeUsedTrafficBytes', 0)), online_at=self._parse_optional_datetime(traffic_data.get('onlineAt')), first_connected_at=self._parse_optional_datetime(traffic_data.get('firstConnectedAt')), last_connected_node_uuid=traffic_data.get('lastConnectedNodeUuid'))
    def _parse_optional_datetime(self, date_str: Optional[str]) -> Optional[datetime]:
        if date_str:
            return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        return None
    def _parse_internal_squad(self, squad_data: Dict) -> RemnaWaveInternalSquad:
        info = squad_data.get('info', {})
        return RemnaWaveInternalSquad(uuid=squad_data['uuid'], name=squad_data['name'], members_count=info.get('membersCount', 0), inbounds_count=info.get('inboundsCount', 0), inbounds=squad_data.get('inbounds', []), view_position=squad_data.get('viewPosition', 0), created_at=self._parse_optional_datetime(squad_data.get('createdAt')), updated_at=self._parse_optional_datetime(squad_data.get('updatedAt')))

def get_remnawave_api():
    api_url = os.getenv('REMWAVE_PANEL_URL') or os.getenv('REMWAVE_API_URL', 'http://localhost:3000')
    if api_url and (not api_url.startswith('http://')) and (not api_url.startswith('https://')):
        api_url = 'https://' + api_url
    api_key = os.getenv('REMWAVE_API_KEY', '')
    secret_key = os.getenv('REMWAVE_SECRET_KEY')
    caddy_token = os.getenv('REMWAVE_CADDY_TOKEN')
    return RemnaWaveAPI(base_url=api_url, api_key=api_key, secret_key=secret_key, caddy_token=caddy_token)

def sanitize_remnawave_username(username: str, telegram_id: int) -> str:
    import re
    if not username:
        return f'user_{telegram_id}'
    sanitized = re.sub('[^a-zA-Z0-9_-]', '', username)
    if not sanitized:
        return f'user_{telegram_id}'
    if sanitized[0] in '_-':
        sanitized = f'u{sanitized}'
    return sanitized

class RemnawaveAPI:
    def __init__(self):
        self._api = get_remnawave_api()
    def create_user(self, telegram_id: int, username: str=None, email: str=None):
        safe_username = sanitize_remnawave_username(username, telegram_id)
        async def _create():
            async with self._api as api:
                expire_at = datetime.now() + timedelta(days=30)
                return await api.create_user(safe_username, expire_at, telegram_id=telegram_id, email=email)
        return asyncio.run(_create())
    def get_user_by_telegram_id(self, telegram_id: int):
        async def _get():
            async with self._api as api:
                return await api.get_user_by_telegram_id(telegram_id)
        return asyncio.run(_get())
    def create_subscription(self, user_uuid: str, days: int, traffic_limit: int=None):
        async def _create():
            async with self._api as api:
                expire_at = datetime.now() + timedelta(days=days)
                return await api.update_user(user_uuid, expire_at=expire_at, traffic_limit_bytes=traffic_limit)
        return asyncio.run(_create())
    def update_user_sync(self, uuid: str, expire_at: datetime=None, traffic_limit_bytes: int=None, hwid_device_limit: int=None, active_internal_squads: List[str]=None, status: UserStatus=None):
        async def _update():
            async with self._api as api:
                return await api.update_user(uuid, expire_at=expire_at, traffic_limit_bytes=traffic_limit_bytes, hwid_device_limit=hwid_device_limit, active_internal_squads=active_internal_squads, status=status)
        return asyncio.run(_update())
    def create_user_with_params(self, telegram_id: int, username: str, days: int, traffic_limit_bytes: int=0, hwid_device_limit: int=None, active_internal_squads: List[str]=None):
        safe_username = sanitize_remnawave_username(username, telegram_id)
        async def _create():
            async with self._api as api:
                expire_at = datetime.now() + timedelta(days=days)
                return await api.create_user(safe_username, expire_at, telegram_id=telegram_id, traffic_limit_bytes=traffic_limit_bytes, hwid_device_limit=hwid_device_limit, active_internal_squads=active_internal_squads)
        return asyncio.run(_create())
    def get_internal_squads(self):
        async def _get():
            async with self._api as api:
                return await api.get_internal_squads()
        return asyncio.run(_get())
    def delete_user_sync(self, uuid: str) -> bool:
        async def _delete():
            async with self._api as api:
                return await api.delete_user(uuid)
        return asyncio.run(_delete())
    def get_all_users_sync(self, start: int=0, size: int=100):
        async def _get():
            async with self._api as api:
                return await api.get_all_users(start, size)
        return asyncio.run(_get())
remnawave_api = RemnawaveAPI()
