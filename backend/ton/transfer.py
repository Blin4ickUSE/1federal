import asyncio
import logging
import os
import re
import threading
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

USDT_JETTON_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
USDT_DECIMALS = 6
RUB_PER_USD = 85
MAX_WITHDRAW_RUB = 5000
MAX_USDT_MICRO = int(round(MAX_WITHDRAW_RUB / RUB_PER_USD * 10 ** USDT_DECIMALS))
JETTON_TRANSFER_OP = 0x0F8A7EA5
GAS_TON_NANOTONS = int(0.08 * 1_000_000_000)

TON_MAINNET_ADDRESS_RE = re.compile(r'^(EQ|UQ)[A-Za-z0-9_-]{46}$')

_send_lock = threading.Lock()


def rub_to_usdt(amount_rub: float) -> float:
    return round(amount_rub / RUB_PER_USD, 6)


def rub_to_usdt_micro(amount_rub: float) -> int:
    if amount_rub <= 0 or amount_rub > MAX_WITHDRAW_RUB:
        raise ValueError('amount out of allowed range')
    micro = int(round(rub_to_usdt(amount_rub) * 10 ** USDT_DECIMALS))
    if micro <= 0 or micro > MAX_USDT_MICRO:
        raise ValueError('usdt amount out of allowed range')
    return micro


def _address_to_user_friendly(address: str) -> Optional[str]:
    addr = (address or '').strip()
    if not addr:
        return None
    try:
        from pytoniq_core import Address
        parsed = Address(addr)
        if parsed.wc != 0:
            return None
        return parsed.to_str(is_user_friendly=True, is_url_safe=True)
    except Exception:
        return None


def _is_mainnet_address(address: str) -> bool:
    # ВАЖНО: никакого .lower() — base64url регистрозависим
    addr = (address or '').strip()
    if len(addr) != 48 or any(c.isspace() for c in addr):
        return False
    if not TON_MAINNET_ADDRESS_RE.match(addr):
        return False
    return _address_to_user_friendly(addr) is not None


def normalize_ton_address(address: str) -> Optional[str]:
    addr = (address or '').strip()
    if not _is_mainnet_address(addr):
        return None
    return _address_to_user_friendly(addr)


def is_valid_ton_address(address: str) -> bool:
    return _is_mainnet_address(address)


# --- Совместимость со старым API вызывающего кода ---
# Домены .ton / .t.me и @username больше НЕ поддерживаются: только EQ.../UQ...

def is_ton_recipient_format(raw: str) -> bool:
    return _is_mainnet_address(raw)


def resolve_ton_recipient(raw: str) -> Optional[str]:
    return normalize_ton_address(raw)


def is_valid_ton_recipient(raw: str) -> bool:
    return _is_mainnet_address(raw)


def get_mnemonic() -> Optional[list[str]]:
    raw = os.getenv('TON_WALLET_MNEMONIC', '').strip()
    if not raw:
        return None
    words = raw.split()
    if len(words) not in (12, 24):
        return None
    return words


def _safe_public_error() -> str:
    return 'Не удалось отправить USDT. Попробуйте позже или обратитесь в поддержку.'


async def _send_usdt_async(
    recipient: str,
    usdt_micro: int,
    expected_address: Optional[str] = None,
) -> Tuple[bool, str]:
    from pytoniq import LiteBalancer, begin_cell, WalletV4R2
    from pytoniq_core import Address

    if not isinstance(usdt_micro, int) or isinstance(usdt_micro, bool):
        return False, 'Некорректная сумма USDT'
    if usdt_micro <= 0 or usdt_micro > MAX_USDT_MICRO:
        return False, 'Сумма USDT вне допустимого диапазона'

    normalized = normalize_ton_address(recipient)
    if not normalized:
        return False, 'Некорректный адрес TON. Укажите адрес кошелька EQ.../UQ...'

    expected = normalize_ton_address(expected_address) if expected_address else None
    if expected and expected != normalized:
        logger.warning(
            'TON recipient address changed: expected %s resolved %s for %s',
            expected,
            normalized,
            recipient,
        )
        return False, 'Адрес получателя изменился. Повторите вывод позже.'

    mnemonics = get_mnemonic()
    if not mnemonics:
        logger.error('TON USDT transfer: mnemonic missing or invalid length')
        return False, 'TON кошелёк не настроен'

    provider = LiteBalancer.from_mainnet_config(2)
    await provider.start_up()
    try:
        wallet = await WalletV4R2.from_mnemonic(provider, mnemonics)
        user_address = wallet.address
        destination = Address(normalized)
        if destination.wc != 0:
            return False, 'Некорректный адрес USDT-кошелька в сети TON'

        jetton_master = Address(USDT_JETTON_MASTER)
        user_jetton_wallet = (
            await provider.run_get_method(
                address=jetton_master,
                method='get_wallet_address',
                stack=[begin_cell().store_address(user_address).end_cell().begin_parse()],
            )
        )[0].load_address()

        transfer_body = (
            begin_cell()
            .store_uint(JETTON_TRANSFER_OP, 32)
            .store_uint(0, 64)
            .store_coins(usdt_micro)
            .store_address(destination)
            .store_address(user_address)
            .store_bit(0)
            .store_coins(1)
            .store_bit(0)
            .end_cell()
        )
        await wallet.transfer(
            destination=user_jetton_wallet,
            amount=GAS_TON_NANOTONS,
            body=transfer_body,
        )
        logger.info('TON USDT sent to %s (%s micro) from input %s', normalized, usdt_micro, recipient)
        return True, 'USDT отправлен'
    except Exception:
        logger.exception('TON USDT transfer failed for %s micro=%s', normalized, usdt_micro)
        return False, _safe_public_error()
    finally:
        await provider.close_all()


def send_usdt_on_ton(
    recipient: str,
    usdt_micro: int,
    expected_address: Optional[str] = None,
) -> Tuple[bool, str]:
    with _send_lock:
        try:
            return asyncio.run(_send_usdt_async(recipient, usdt_micro, expected_address))
        except Exception:
            logger.exception('TON USDT transfer wrapper failed')
            return False, _safe_public_error()
