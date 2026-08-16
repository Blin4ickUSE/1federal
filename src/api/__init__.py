"""Incy crypt1 deep-link encoder (AES-256-GCM, keymat shared with INCY clients)."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from typing import Optional

_SALT = b'incy' + b'deep' + b'crypt1' + b'v2026.06'
_KEYMAT_A_OFFSET = 1024
_KEYMAT_B_OFFSET = 2048
_KEYMAT_LEN = 32
_EXPECTED_FP = 'b6bf708471cc90043232967660aade86a50b4e57929db2e53c5fa34db624c08c'
_SCHEME = 'incy'
_HOST = 'crypt1'
_DEFAULT_NAME = '1FEDERAL VPN'

_key_cache: Optional[bytes] = None


def _load_keymat() -> tuple[bytes, bytes]:
    path = os.path.join(os.path.dirname(__file__), 'incy_keymat.json')
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    a = base64.b64decode(data['a'])
    b = base64.b64decode(data['b'])
    return (a, b)


def _derive_key() -> bytes:
    global _key_cache
    if _key_cache is not None:
        return _key_cache
    a, b = _load_keymat()
    if len(a) < _KEYMAT_A_OFFSET + _KEYMAT_LEN or len(b) < _KEYMAT_B_OFFSET + _KEYMAT_LEN:
        raise RuntimeError('incy keymat assets are smaller than expected')
    km_a = a[_KEYMAT_A_OFFSET:_KEYMAT_A_OFFSET + _KEYMAT_LEN]
    km_b = b[_KEYMAT_B_OFFSET:_KEYMAT_B_OFFSET + _KEYMAT_LEN]
    seed = _SALT + km_a + km_b
    key = hashlib.sha256(seed).digest()
    fp = hashlib.sha256(key).hexdigest()
    if fp != _EXPECTED_FP:
        raise RuntimeError(f'incy K1 fingerprint mismatch: expected {_EXPECTED_FP}, got {fp}')
    _key_cache = key
    return key


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')


def _sorted_compact_json(payload: dict) -> str:
    keys = sorted(payload.keys())
    parts = [
        f'{json.dumps(k, ensure_ascii=False)}:{json.dumps(payload[k], ensure_ascii=False, separators=(",", ":"))}'
        for k in keys
    ]
    return '{' + ','.join(parts) + '}'


def encrypt_incy_crypt1(url: str, name: Optional[str] = _DEFAULT_NAME) -> str:
    """Build incy://crypt1/<payload> deep link for a subscription URL."""
    if not url or not isinstance(url, str):
        raise TypeError('url must be a non-empty string')
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = _derive_key()
    payload: dict = {'url': url, 'v': 1}
    if name:
        payload['n'] = name[:128]
    plaintext = _sorted_compact_json(payload).encode('utf-8')
    iv = secrets.token_bytes(12)
    aesgcm = AESGCM(key)
    # AESGCM.encrypt returns ciphertext || tag
    ct_and_tag = aesgcm.encrypt(iv, plaintext, None)
    wire = iv + ct_and_tag
    return f'{_SCHEME}://{_HOST}/{_b64url_encode(wire)}'
