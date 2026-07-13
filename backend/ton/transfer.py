import asyncio
import logging
import os
import re
from typing import Optional, Tuple
logger = logging.getLogger(__name__)
USDT_JETTON_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
USDT_DECIMALS = 6
RUB_PER_USD = 85
TON_ADDRESS_RE = re.compile('^(EQ|UQ|kQ)[A-Za-z0-9_-]{46}$')

def rub_to_usdt(amount_rub: float) -> float:
    return round(amount_rub / RUB_PER_USD, 6)

def rub_to_usdt_micro(amount_rub: float) -> int:
    return int(round(rub_to_usdt(amount_rub) * 10 ** USDT_DECIMALS))

def is_valid_ton_address(address: str) -> bool:
    addr = (address or '').strip()
    if len(addr) > 48 or any((c.isspace() for c in addr)):
        return False
    if not TON_ADDRESS_RE.match(addr):
        return False
    try:
        from pytoniq_core import Address
        Address(addr)
        return True
    except Exception:
        return False

def normalize_ton_address(address: str) -> Optional[str]:
    addr = (address or '').strip()
    if not is_valid_ton_address(addr):
        return None
    try:
        from pytoniq_core import Address
        return Address(addr).to_str(is_user_friendly=True, is_url_safe=True)
    except Exception:
        return None

def get_mnemonic() -> Optional[list[str]]:
    raw = os.getenv('TON_WALLET_MNEMONIC', '').strip()
    if not raw:
        return None
    words = raw.split()
    return words if len(words) >= 12 else None

async def _send_usdt_async(recipient_address: str, usdt_micro: int) -> Tuple[bool, str]:
    from pytoniq import LiteBalancer, begin_cell
    from pytoniq.contract.wallet import WalletV4R2
    from pytoniq_core import Address
    if usdt_micro <= 0:
        return (False, 'Сумма USDT должна быть больше 0')
    mnemonics = get_mnemonic()
    if not mnemonics:
        return (False, 'TON кошелёк не настроен (TON_WALLET_MNEMONIC)')
    provider = LiteBalancer.from_mainnet_config(1)
    await provider.start_up()
    try:
        wallet = await WalletV4R2.from_mnemonic(provider=provider, mnemonics=mnemonics)
        user_address = wallet.address
        destination = Address(recipient_address.strip())
        jetton_master = Address(USDT_JETTON_MASTER)
        user_jetton_wallet = (await provider.run_get_method(address=jetton_master, method='get_wallet_address', stack=[begin_cell().store_address(user_address).end_cell().begin_parse()]))[0].load_address()
        transfer_body = begin_cell().store_uint(260734629, 32).store_uint(0, 64).store_coins(usdt_micro).store_address(destination).store_address(user_address).store_bit(0).store_coins(1).store_bit(0).end_cell()
        await wallet.transfer(destination=user_jetton_wallet, amount=int(0.08 * 1000000000.0), body=transfer_body)
        return (True, 'USDT отправлен')
    except Exception as e:
        logger.error(f'TON USDT transfer failed: {e}')
        return (False, str(e))
    finally:
        await provider.close_all()

def send_usdt_on_ton(recipient_address: str, usdt_micro: int) -> Tuple[bool, str]:
    try:
        return asyncio.run(_send_usdt_async(recipient_address, usdt_micro))
    except Exception as e:
        logger.error(f'TON USDT transfer wrapper failed: {e}')
        return (False, str(e))
