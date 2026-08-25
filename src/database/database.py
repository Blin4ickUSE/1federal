import sqlite3
import os
import logging
import hmac
import secrets
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple
import hashlib
logger = logging.getLogger(__name__)
DB_PATH = os.getenv('DB_PATH', 'data.db')

def get_db_connection():
    db_dir = os.path.dirname(os.path.abspath(DB_PATH))
    if db_dir and (not os.path.exists(db_dir)):
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL;')
    conn.execute('PRAGMA busy_timeout=5000;')
    return conn

def _migrate_users_telegram_id_nullable(cursor, conn):
    """Allow NULL telegram_id for email-only accounts (SQLite cannot ALTER nullability)."""
    try:
        cursor.execute('PRAGMA table_info(users)')
        cols = {row[1]: row for row in cursor.fetchall()}
        tg_col = cols.get('telegram_id')
        if not tg_col:
            return
        # row: cid, name, type, notnull, dflt_value, pk
        if int(tg_col[3] or 0) == 0:
            return
        cursor.execute('PRAGMA table_info(users)')
        all_cols = list(cursor.fetchall())
        col_defs = []
        col_names = []
        for c in all_cols:
            name, ctype, notnull, dflt, pk = c[1], c[2], c[3], c[4], c[5]
            col_names.append(name)
            if name == 'telegram_id':
                col_defs.append('telegram_id INTEGER UNIQUE')
            elif pk:
                col_defs.append(f'{name} INTEGER PRIMARY KEY AUTOINCREMENT')
            else:
                piece = f'{name} {ctype or "TEXT"}'
                if notnull and name != 'telegram_id':
                    piece += ' NOT NULL'
                if dflt is not None:
                    piece += f' DEFAULT {dflt}'
                col_defs.append(piece)
        cursor.execute('BEGIN IMMEDIATE')
        cursor.execute(f'CREATE TABLE users_email_mig ({", ".join(col_defs)})')
        names_sql = ', '.join(col_names)
        cursor.execute(f'INSERT INTO users_email_mig ({names_sql}) SELECT {names_sql} FROM users')
        cursor.execute('DROP TABLE users')
        cursor.execute('ALTER TABLE users_email_mig RENAME TO users')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)')
        conn.commit()
        logger.info('Migrated users.telegram_id to nullable')
    except Exception as e:
        logger.warning(f'users.telegram_id nullable migration skipped/failed: {e}')
        try:
            conn.rollback()
        except Exception:
            pass

def hash_user_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.sha256(f'{salt}:{password}'.encode()).hexdigest()
    return f'{salt}:{digest}'

def verify_user_password(password_hash: str, password: str) -> bool:
    if not password_hash or ':' not in password_hash:
        return False
    salt, expected = password_hash.split(':', 1)
    computed = hashlib.sha256(f'{salt}:{password}'.encode()).hexdigest()
    return hmac.compare_digest(computed, expected)

def init_database():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("\n            CREATE TABLE IF NOT EXISTS users (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                telegram_id INTEGER UNIQUE,\n                email TEXT UNIQUE,\n                password_hash TEXT,\n                email_verified_at TIMESTAMP,\n                username TEXT,\n                full_name TEXT,\n                balance REAL DEFAULT 0,\n                status TEXT DEFAULT 'Trial',\n                registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                paid_until TIMESTAMP,\n                referral_code TEXT UNIQUE,\n                referred_by INTEGER,\n                is_partner INTEGER DEFAULT 0,\n                partner_rate INTEGER DEFAULT 30,\n                partner_balance REAL DEFAULT 0,\n                total_earned REAL DEFAULT 0,\n                trial_used INTEGER DEFAULT 0,\n                banned_keys_count INTEGER DEFAULT 0,\n                is_banned INTEGER DEFAULT 0,\n                ban_reason TEXT,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                FOREIGN KEY (referred_by) REFERENCES users(id)\n            )\n        ")
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN promo_discount_percent REAL')
        except sqlite3.OperationalError:
            pass
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN pending_promo_id INTEGER')
        except sqlite3.OperationalError:
            pass
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN pending_promo_days INTEGER')
        except sqlite3.OperationalError:
            pass
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN referral_withdraw_blocked INTEGER DEFAULT 0')
        except sqlite3.OperationalError:
            pass
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN email TEXT')
        except sqlite3.OperationalError:
            pass
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN password_hash TEXT')
        except sqlite3.OperationalError:
            pass
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP')
        except sqlite3.OperationalError:
            pass
        _migrate_users_telegram_id_nullable(cursor, conn)
        try:
            cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL')
        except sqlite3.OperationalError:
            pass
        cursor.execute("\n            CREATE TABLE IF NOT EXISTS vpn_keys (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                user_id INTEGER NOT NULL,\n                key_uuid TEXT UNIQUE,\n                key_config TEXT,\n                status TEXT DEFAULT 'Active',\n                expiry_date TIMESTAMP,\n                traffic_used REAL DEFAULT 0,\n                traffic_limit REAL,\n                devices_limit INTEGER DEFAULT 1,\n                server_location TEXT,\n                hwid_hash TEXT,\n                last_used TIMESTAMP,\n                last_ip TEXT,\n                squad_uuid TEXT,\n                plan_type TEXT DEFAULT 'vpn',\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                FOREIGN KEY (user_id) REFERENCES users(id)\n            )\n        ")
        cursor.execute("\n            CREATE TABLE IF NOT EXISTS transactions (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                user_id INTEGER NOT NULL,\n                type TEXT NOT NULL,\n                amount REAL NOT NULL,\n                status TEXT DEFAULT 'Pending',\n                payment_method TEXT,\n                payment_provider TEXT,\n                payment_id TEXT,\n                description TEXT,\n                duration_days INTEGER,\n                hash TEXT,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                FOREIGN KEY (user_id) REFERENCES users(id)\n            )\n        ")
        try:
            cursor.execute('ALTER TABLE transactions ADD COLUMN duration_days INTEGER')
        except sqlite3.OperationalError:
            pass
        cursor.execute("\n            CREATE TABLE IF NOT EXISTS promocodes (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                code TEXT UNIQUE NOT NULL,\n                type TEXT NOT NULL,\n                value TEXT NOT NULL,\n                uses_count INTEGER DEFAULT 0,\n                uses_limit INTEGER,\n                expires_at TIMESTAMP,\n                is_active INTEGER DEFAULT 1,\n                target_type TEXT DEFAULT 'all',\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ")
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS promocode_uses (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                promocode_id INTEGER NOT NULL,\n                user_id INTEGER NOT NULL,\n                used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                FOREIGN KEY (promocode_id) REFERENCES promocodes(id),\n                FOREIGN KEY (user_id) REFERENCES users(id),\n                UNIQUE(promocode_id, user_id)\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS traffic_stats (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                vpn_key_id INTEGER,\n                user_id INTEGER NOT NULL,\n                date DATE NOT NULL,\n                traffic_bytes REAL DEFAULT 0,\n                unique_hwids INTEGER DEFAULT 0,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                FOREIGN KEY (vpn_key_id) REFERENCES vpn_keys(id),\n                FOREIGN KEY (user_id) REFERENCES users(id),\n                UNIQUE(vpn_key_id, date)\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS blacklist (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                telegram_id INTEGER UNIQUE NOT NULL,\n                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ')
        cursor.execute("\n            CREATE TABLE IF NOT EXISTS mailings (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                title TEXT,\n                message_text TEXT,\n                target_users TEXT,\n                sent_count INTEGER DEFAULT 0,\n                status TEXT DEFAULT 'Pending',\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                sent_at TIMESTAMP,\n                button_type TEXT,\n                button_value TEXT,\n                image_url TEXT\n            )\n        ")
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS mailing_deliveries (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                mailing_id INTEGER NOT NULL,\n                user_id INTEGER,\n                telegram_id INTEGER NOT NULL,\n                chat_id INTEGER NOT NULL,\n                message_id INTEGER NOT NULL,\n                deleted_at TIMESTAMP,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                FOREIGN KEY (mailing_id) REFERENCES mailings(id),\n                FOREIGN KEY (user_id) REFERENCES users(id)\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS tariff_plans (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                plan_type TEXT NOT NULL,\n                name TEXT NOT NULL,\n                price REAL NOT NULL,\n                duration_days INTEGER NOT NULL,\n                is_active INTEGER DEFAULT 1,\n                sort_order INTEGER DEFAULT 0,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ')
        cursor.execute("\n            CREATE TABLE IF NOT EXISTS whitelist_settings (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                subscription_fee REAL DEFAULT 100.0,\n                price_per_gb REAL DEFAULT 15.0,\n                min_gb INTEGER DEFAULT 5,\n                max_gb INTEGER DEFAULT 500,\n                auto_pay_enabled INTEGER DEFAULT 1,\n                auto_pay_threshold_mb INTEGER DEFAULT 100,\n                pricing_type TEXT DEFAULT 'fixed',\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ")
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS auto_discounts (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                name TEXT NOT NULL,\n                condition_type TEXT NOT NULL,\n                condition_value TEXT NOT NULL,\n                discount_type TEXT NOT NULL,\n                discount_value REAL NOT NULL,\n                is_active INTEGER DEFAULT 1,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS public_pages (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                page_type TEXT UNIQUE NOT NULL,\n                content TEXT NOT NULL,\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS system_settings (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                setting_key TEXT UNIQUE NOT NULL,\n                setting_value TEXT NOT NULL,\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ')
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS developer_share_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_type TEXT NOT NULL,
                amount REAL NOT NULL,
                balance_after REAL NOT NULL,
                source_transaction_id INTEGER,
                note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_dev_share_ledger_created ON developer_share_ledger(created_at)')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS payment_fees (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                payment_method TEXT UNIQUE NOT NULL,\n                fee_percent REAL DEFAULT 0.0,\n                fee_fixed REAL DEFAULT 0.0,\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS saved_payment_methods (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                user_id INTEGER NOT NULL,\n                payment_provider TEXT NOT NULL,\n                payment_method_id TEXT NOT NULL,\n                payment_method_type TEXT,\n                card_last4 TEXT,\n                card_brand TEXT,\n                is_active INTEGER DEFAULT 1,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                FOREIGN KEY (user_id) REFERENCES users(id),\n                UNIQUE(user_id, payment_provider, payment_method_id)\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS payment_provider_settings (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                provider TEXT NOT NULL,\n                setting_key TEXT NOT NULL,\n                setting_value TEXT,\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                UNIQUE(provider, setting_key)\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS backup_settings (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                enabled INTEGER DEFAULT 0,\n                interval_hours INTEGER DEFAULT 6,\n                interval_minutes INTEGER DEFAULT 360,\n                last_backup TIMESTAMP,\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ')
        try:
            cursor.execute('ALTER TABLE backup_settings ADD COLUMN interval_minutes INTEGER DEFAULT 360')
        except Exception:
            pass
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS squad_configs (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                squad_uuid TEXT UNIQUE NOT NULL,\n                squad_name TEXT NOT NULL,\n                squad_type TEXT NOT NULL,\n                max_users INTEGER DEFAULT 0,\n                current_users INTEGER DEFAULT 0,\n                is_active INTEGER DEFAULT 1,\n                priority INTEGER DEFAULT 0,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS subscription_squad_mapping (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                subscription_type TEXT NOT NULL,\n                squad_uuid TEXT NOT NULL,\n                is_active INTEGER DEFAULT 1,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                UNIQUE(subscription_type, squad_uuid)\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS panel_admins (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                username TEXT UNIQUE NOT NULL,\n                password_hash TEXT NOT NULL,\n                is_active INTEGER DEFAULT 1,\n                last_login TIMESTAMP,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS panel_sessions (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                admin_id INTEGER NOT NULL,\n                session_token TEXT UNIQUE NOT NULL,\n                expires_at TIMESTAMP NOT NULL,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                FOREIGN KEY (admin_id) REFERENCES panel_admins(id)\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS panel_login_otp (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                admin_id INTEGER NOT NULL,\n                code_hash TEXT NOT NULL,\n                ip_address TEXT,\n                user_agent TEXT,\n                expires_at TIMESTAMP NOT NULL,\n                used_at TIMESTAMP,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n                FOREIGN KEY (admin_id) REFERENCES panel_admins(id)\n            )\n        ')
        cursor.execute('\n            CREATE TABLE IF NOT EXISTS miniapp_sessions (\n                id INTEGER PRIMARY KEY AUTOINCREMENT,\n                user_id INTEGER,\n                telegram_id INTEGER,\n                session_token TEXT UNIQUE NOT NULL,\n                username TEXT,\n                first_name TEXT,\n                photo_url TEXT,\n                expires_at TIMESTAMP NOT NULL,\n                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n            )\n        ')
        try:
            cursor.execute('ALTER TABLE miniapp_sessions ADD COLUMN user_id INTEGER')
        except sqlite3.OperationalError:
            pass
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_otps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                purpose TEXT NOT NULL,
                user_id INTEGER,
                payload TEXT,
                ip_address TEXT,
                attempts INTEGER DEFAULT 0,
                expires_at TIMESTAMP NOT NULL,
                used_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_email_otps_email ON email_otps(email)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_email_otps_purpose ON email_otps(purpose)')
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pending_account_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                initiator_user_id INTEGER NOT NULL,
                other_user_id INTEGER NOT NULL,
                link_type TEXT NOT NULL,
                status TEXT DEFAULT 'awaiting_choice',
                chosen_primary_user_id INTEGER,
                link_email TEXT,
                link_telegram_id INTEGER,
                link_password_hash TEXT,
                payload TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (initiator_user_id) REFERENCES users(id),
                FOREIGN KEY (other_user_id) REFERENCES users(id)
            )
        """)
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_pending_links_initiator ON pending_account_links(initiator_user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_pending_links_status ON pending_account_links(status)')
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS recurring_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subscription_id TEXT UNIQUE NOT NULL,
                status TEXT DEFAULT 'PENDING',
                amount REAL NOT NULL,
                duration_days INTEGER NOT NULL,
                plan_type TEXT DEFAULT 'vpn_regular',
                tariff_category TEXT DEFAULT 'regular',
                devices_limit INTEGER DEFAULT 2,
                vpn_key_id INTEGER,
                card_token TEXT,
                saved_method_id INTEGER,
                next_charge_at TIMESTAMP,
                last_charge_at TIMESTAMP,
                retry_count INTEGER DEFAULT 0,
                fail_notified INTEGER DEFAULT 0,
                converts_from_trial INTEGER DEFAULT 0,
                action_type TEXT DEFAULT 'wizard',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_recurring_subs_user ON recurring_subscriptions(user_id)')
        # Дефолтные настройки системы
        default_settings = {
            'trial_tariff_id': '',       # ID тарифа из tariff_plans для конвертации триала
            'trial_devices_limit': '1',  # Кол-во устройств на триале
            'paid_devices_limit': '2',   # Кол-во устройств на платной подписке
        }
        for key, val in default_settings.items():
            cursor.execute(
                "INSERT OR IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)",
                (key, val),
            )
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_recurring_subs_status ON recurring_subscriptions(status)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_recurring_subs_next ON recurring_subscriptions(next_charge_at)')
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS payment_intents (
                invoice_id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                days INTEGER NOT NULL,
                plan_type TEXT DEFAULT 'vpn_regular',
                tariff_category TEXT DEFAULT 'regular',
                devices_limit INTEGER DEFAULT 2,
                is_trial INTEGER DEFAULT 0,
                action_type TEXT DEFAULT 'wizard',
                vpn_key_id INTEGER,
                status TEXT DEFAULT 'pending',
                payment_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_payment_intents_user ON payment_intents(user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_vpn_keys_user_id ON vpn_keys(user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_vpn_keys_status ON vpn_keys(status)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_vpn_keys_key_uuid ON vpn_keys(key_uuid)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_traffic_stats_date ON traffic_stats(date)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_blacklist_telegram_id ON blacklist(telegram_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_mailing_deliveries_mailing_id ON mailing_deliveries(mailing_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_panel_login_otp_admin_id ON panel_login_otp(admin_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_miniapp_sessions_token ON miniapp_sessions(session_token)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_miniapp_sessions_telegram_id ON miniapp_sessions(telegram_id)')
        conn.commit()
        desired_tariff_plans = [
            {'plan_type': 'vpn_regular', 'name': '1 месяц', 'price': 499, 'duration_days': 30, 'sort_order': 1},
            {'plan_type': 'vpn_regular', 'name': '3 месяца', 'price': 1399, 'duration_days': 90, 'sort_order': 2},
            {'plan_type': 'vpn_regular', 'name': '6 месяцев', 'price': 2699, 'duration_days': 180, 'sort_order': 3},
            {'plan_type': 'vpn_regular', 'name': '12 месяцев', 'price': 4999, 'duration_days': 365, 'sort_order': 4},
            {'plan_type': 'vpn_family', 'name': '1 месяц', 'price': 899, 'duration_days': 30, 'sort_order': 1},
            {'plan_type': 'vpn_family', 'name': '3 месяца', 'price': 2499, 'duration_days': 90, 'sort_order': 2},
            {'plan_type': 'vpn_family', 'name': '6 месяцев', 'price': 4899, 'duration_days': 180, 'sort_order': 3},
            {'plan_type': 'vpn_family', 'name': '12 месяцев', 'price': 8999, 'duration_days': 365, 'sort_order': 4},
        ]
        active_ids_to_keep = []
        active_type_days = set()
        for p in desired_tariff_plans:
            cursor.execute('\n                SELECT id FROM tariff_plans\n                WHERE plan_type = ? AND duration_days = ?\n                ORDER BY id\n                LIMIT 1\n                ', (p['plan_type'], p['duration_days']))
            row = cursor.fetchone()
            if row:
                active_ids_to_keep.append(row['id'])
                active_type_days.add((p['plan_type'], p['duration_days']))
                cursor.execute('\n                    UPDATE tariff_plans\n                    SET name = ?, price = ?, is_active = 1, sort_order = ?, updated_at = CURRENT_TIMESTAMP\n                    WHERE id = ?\n                    ', (p['name'], p['price'], p['sort_order'], row['id']))
            else:
                cursor.execute('\n                    INSERT INTO tariff_plans (plan_type, name, price, duration_days, is_active, sort_order)\n                    VALUES (?, ?, ?, ?, 1, ?)\n                    ', (p['plan_type'], p['name'], p['price'], p['duration_days'], p['sort_order']))
                active_ids_to_keep.append(cursor.lastrowid)
                active_type_days.add((p['plan_type'], p['duration_days']))
        cursor.execute("\n            UPDATE tariff_plans\n            SET is_active = 0, updated_at = CURRENT_TIMESTAMP\n            WHERE plan_type IN ('vpn', 'vpn_regular', 'vpn_family')\n            ")
        if active_ids_to_keep:
            keep_placeholders = ','.join(['?'] * len(active_ids_to_keep))
            cursor.execute(f'\n                UPDATE tariff_plans\n                SET is_active = 1, updated_at = CURRENT_TIMESTAMP\n                WHERE id IN ({keep_placeholders})\n                ', tuple(active_ids_to_keep))
        cursor.execute('SELECT COUNT(*) FROM whitelist_settings')
        if cursor.fetchone()[0] == 0:
            cursor.execute("\n                INSERT INTO whitelist_settings (subscription_fee, price_per_gb, min_gb, max_gb, pricing_type)\n                VALUES (299.0, 15.0, 100, 500, 'fixed')\n            ")
        for page_type in ['offer', 'privacy']:
            cursor.execute('SELECT COUNT(*) FROM public_pages WHERE page_type = ?', (page_type,))
            if cursor.fetchone()[0] == 0:
                cursor.execute("INSERT INTO public_pages (page_type, content) VALUES (?, '')", (page_type,))
        for method in ['cloudpayments', 'crypto']:
            cursor.execute('SELECT COUNT(*) FROM payment_fees WHERE payment_method = ?', (method,))
            if cursor.fetchone()[0] == 0:
                cursor.execute('INSERT INTO payment_fees (payment_method) VALUES (?)', (method,))
        conn.commit()
        logger.info('Database initialized')
    except Exception as e:
        logger.error(f'Database init error: {e}')
        conn.rollback()
        raise
    finally:
        conn.close()

def create_user(telegram_id: int=None, username: str=None, full_name: str=None, referred_by: int=None, email: str=None, password_hash: str=None, email_verified: bool=False) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if telegram_id is not None:
            referral_code = f'REF{telegram_id}'
        else:
            referral_code = f'REF{secrets.token_hex(6)}'
        email_norm = (email or '').strip().lower() or None
        verified_at = datetime.now().isoformat() if email_verified and email_norm else None
        cursor.execute('\n            INSERT INTO users (telegram_id, email, password_hash, email_verified_at, username, full_name, referral_code, referred_by)\n            VALUES (?, ?, ?, ?, ?, ?, ?, ?)\n        ', (telegram_id, email_norm, password_hash, verified_at, username, full_name, referral_code, referred_by))
        user_id = cursor.lastrowid
        if telegram_id is None and user_id:
            cursor.execute('UPDATE users SET referral_code = ? WHERE id = ?', (f'REF{user_id}', user_id))
        conn.commit()
        return user_id
    except sqlite3.IntegrityError:
        if telegram_id is not None:
            cursor.execute('SELECT id FROM users WHERE telegram_id = ?', (telegram_id,))
            row = cursor.fetchone()
            return row[0] if row else None
        if email_norm:
            cursor.execute('SELECT id FROM users WHERE email = ?', (email_norm,))
            row = cursor.fetchone()
            return row[0] if row else None
        return None
    finally:
        conn.close()

def get_user_by_telegram_id(telegram_id: int) -> Optional[Dict[str, Any]]:
    if telegram_id is None:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM users WHERE telegram_id = ?', (telegram_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    email_norm = (email or '').strip().lower()
    if not email_norm:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM users WHERE email = ?', (email_norm,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def set_user_email(user_id: int, email: str=None, password_hash: str=None, verified: bool=False) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        email_norm = (email or '').strip().lower() or None
        verified_at = datetime.now().isoformat() if verified and email_norm else None
        if password_hash is not None:
            cursor.execute(
                'UPDATE users SET email = ?, password_hash = ?, email_verified_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                (email_norm, password_hash, verified_at, user_id),
            )
        else:
            cursor.execute(
                'UPDATE users SET email = ?, email_verified_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                (email_norm, verified_at, user_id),
            )
        conn.commit()
        return cursor.rowcount > 0
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def set_user_telegram_id(user_id: int, telegram_id: int=None, username: str=None, full_name: str=None) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if username is not None and full_name is not None:
            cursor.execute(
                'UPDATE users SET telegram_id = ?, username = COALESCE(?, username), full_name = COALESCE(?, full_name), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                (telegram_id, username, full_name, user_id),
            )
        else:
            cursor.execute(
                'UPDATE users SET telegram_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                (telegram_id, user_id),
            )
        conn.commit()
        return cursor.rowcount > 0
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def clear_user_email(user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'UPDATE users SET email = NULL, password_hash = NULL, email_verified_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            (user_id,),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def clear_user_telegram(user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'UPDATE users SET telegram_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            (user_id,),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def get_active_vpn_key_for_user(user_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT * FROM vpn_keys
            WHERE user_id = ? AND status = 'Active'
            ORDER BY expiry_date DESC, id DESC
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def user_has_active_subscription(user_id: int) -> bool:
    key = get_active_vpn_key_for_user(user_id)
    if not key:
        return False
    exp = key.get('expiry_date')
    if not exp:
        return True
    try:
        exp_dt = datetime.fromisoformat(str(exp).replace('Z', '+00:00').replace(' ', 'T'))
        if exp_dt.tzinfo:
            exp_dt = exp_dt.replace(tzinfo=None)
        return exp_dt > datetime.now()
    except Exception:
        return True

def set_user_promo_discount(user_id: int, percent: float) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('UPDATE users SET promo_discount_percent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', (percent, user_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def clear_user_promo_discount(user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('UPDATE users SET promo_discount_percent = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', (user_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def set_pending_promo_subscription(user_id: int, promo_id: int, days: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            UPDATE users\n            SET pending_promo_id = ?, pending_promo_days = ?, updated_at = CURRENT_TIMESTAMP\n            WHERE id = ?\n            ', (promo_id, int(days), user_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def clear_pending_promo_subscription(user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            UPDATE users\n            SET pending_promo_id = NULL, pending_promo_days = NULL, updated_at = CURRENT_TIMESTAMP\n            WHERE id = ?\n            ', (user_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def check_promo_available_for_user(promo_id: int, user_id: int) -> Tuple[bool, str]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT * FROM promocodes WHERE id = ? AND is_active = 1\n            AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)\n            ', (promo_id,))
        row = cursor.fetchone()
        if not row:
            return (False, 'Промокод не найден, истёк или отключён')
        promo = dict(row)
        if promo.get('uses_limit') and promo.get('uses_count', 0) >= promo['uses_limit']:
            return (False, 'Промокод исчерпан')
        cursor.execute('\n            SELECT id FROM promocode_uses WHERE promocode_id = ? AND user_id = ?\n            ', (promo_id, user_id))
        if cursor.fetchone():
            return (False, 'Вы уже использовали этот промокод')
        return (True, '')
    finally:
        conn.close()

def finalize_promo_subscription_use(user_id: int, promo_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('BEGIN IMMEDIATE')
        cursor.execute('INSERT INTO promocode_uses (promocode_id, user_id) VALUES (?, ?)', (promo_id, user_id))
        cursor.execute('UPDATE promocodes SET uses_count = uses_count + 1 WHERE id = ?', (promo_id,))
        cursor.execute('\n            UPDATE users\n            SET pending_promo_id = NULL, pending_promo_days = NULL, updated_at = CURRENT_TIMESTAMP\n            WHERE id = ?\n            ', (user_id,))
        conn.commit()
        return True
    except Exception:
        conn.rollback()
        return False
    finally:
        conn.close()

def update_user_balance(user_id: int, amount: float, ensure_non_negative: bool=False) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('BEGIN IMMEDIATE')
        cursor.execute('SELECT balance FROM users WHERE id = ?', (user_id,))
        row = cursor.fetchone()
        if not row:
            conn.rollback()
            return False
        new_balance = (row['balance'] or 0) + amount
        if ensure_non_negative and new_balance < 0:
            conn.rollback()
            return False
        cursor.execute('UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', (new_balance, user_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def update_user_full_name(telegram_id: int, full_name: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?', (full_name, telegram_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def update_user_username(telegram_id: int, username: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?', (username, telegram_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def get_all_users(limit: int=100, offset: int=0) -> List[Dict[str, Any]]:
    users, _ = search_panel_users(search=None, limit=limit, offset=offset)
    return users

def search_panel_users(search: Optional[str]=None, limit: int=50, offset: int=0) -> Tuple[List[Dict[str, Any]], int]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        where_parts: List[str] = []
        params: List[Any] = []
        if search:
            term = search.strip()
            if term.startswith('@'):
                term = term[1:]
            like = f'%{term}%'
            if term.isdigit():
                where_parts.append('(CAST(telegram_id AS TEXT) LIKE ? OR CAST(id AS TEXT) LIKE ? OR username LIKE ? OR full_name LIKE ? OR referral_code LIKE ? OR IFNULL(email, "") LIKE ?)')
                params.extend([f'%{term}%', f'%{term}%', like, like, like, like])
            else:
                where_parts.append('(username LIKE ? OR full_name LIKE ? OR referral_code LIKE ? OR CAST(telegram_id AS TEXT) LIKE ? OR IFNULL(email, "") LIKE ?)')
                params.extend([like, like, like, like, like])
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ''
        cursor.execute(f'SELECT COUNT(*) AS cnt FROM users {where_sql}', params)
        total = int(cursor.fetchone()['cnt'] or 0)
        cursor.execute(f'SELECT * FROM users {where_sql} ORDER BY id DESC LIMIT ? OFFSET ?', (*params, limit, offset))
        return ([dict(row) for row in cursor.fetchall()], total)
    finally:
        conn.close()

def get_user_vpn_keys(user_id: int) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM vpn_keys WHERE user_id = ? ORDER BY created_at DESC', (user_id,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()

def get_vpn_key_by_uuid(key_uuid: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM vpn_keys WHERE key_uuid = ?', (key_uuid,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def get_vpn_key_by_id(key_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM vpn_keys WHERE id = ?', (key_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def create_vpn_key(user_id: int, key_uuid: str, key_config: str=None, plan_type: str='vpn', expiry_date: str=None, traffic_limit: float=None, squad_uuid: str=None) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            INSERT INTO vpn_keys (user_id, key_uuid, key_config, plan_type, expiry_date, traffic_limit, squad_uuid)\n            VALUES (?, ?, ?, ?, ?, ?, ?)\n        ', (user_id, key_uuid, key_config, plan_type, expiry_date, traffic_limit, squad_uuid))
        key_id = cursor.lastrowid
        conn.commit()
        return key_id
    finally:
        conn.close()

def update_vpn_key(key_id: int, **kwargs) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        allowed = ['status', 'expiry_date', 'traffic_used', 'traffic_limit', 'key_config', 'last_used', 'last_ip', 'squad_uuid', 'plan_type', 'hwid_hash', 'devices_limit']
        updates = []
        values = []
        for k, v in kwargs.items():
            if k in allowed:
                updates.append(f'{k} = ?')
                values.append(v)
        if not updates:
            return False
        values.append(key_id)
        cursor.execute(f"UPDATE vpn_keys SET {', '.join(updates)} WHERE id = ?", values)
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def delete_vpn_key(key_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM vpn_keys WHERE id = ?', (key_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def update_vpn_key_traffic(key_uuid: str, traffic_used: float) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('UPDATE vpn_keys SET traffic_used = ? WHERE key_uuid = ?', (traffic_used, key_uuid))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def count_user_active_keys(user_id: int, plan_type: str=None) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if plan_type:
            cursor.execute("\n                SELECT COUNT(*) FROM vpn_keys \n                WHERE user_id = ? AND status = 'Active' AND plan_type = ?\n            ", (user_id, plan_type))
        else:
            cursor.execute("SELECT COUNT(*) FROM vpn_keys WHERE user_id = ? AND status = 'Active'", (user_id,))
        return cursor.fetchone()[0]
    finally:
        conn.close()

def get_all_vpn_keys(limit: int=100, offset: int=0, plan_type: str=None) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if plan_type:
            cursor.execute('\n                SELECT vk.*, u.telegram_id, u.username \n                FROM vpn_keys vk LEFT JOIN users u ON vk.user_id = u.id\n                WHERE vk.plan_type = ? ORDER BY vk.id DESC LIMIT ? OFFSET ?\n            ', (plan_type, limit, offset))
        else:
            cursor.execute('\n                SELECT vk.*, u.telegram_id, u.username \n                FROM vpn_keys vk LEFT JOIN users u ON vk.user_id = u.id\n                ORDER BY vk.id DESC LIMIT ? OFFSET ?\n            ', (limit, offset))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()

def hash_hwid(hwid: str) -> str:
    return hashlib.sha256(hwid.encode()).hexdigest()

def get_trial_tariff():
    """Вернуть тариф для конвертации триала -> платная подписка."""
    tariff_id = get_system_setting('trial_tariff_id')
    if not tariff_id:
        return None
    conn = get_db_connection()
    try:
        row = conn.execute(
            'SELECT * FROM tariff_plans WHERE id = ? AND is_active = 1', (int(tariff_id),)
        ).fetchone()
        return dict(row) if row else None
    except Exception:
        return None
    finally:
        conn.close()


def get_system_setting(key: str, default: str=None) -> Optional[str]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT setting_value FROM system_settings WHERE setting_key = ?', (key,))
        row = cursor.fetchone()
        return row['setting_value'] if row else default
    finally:
        conn.close()

def set_system_setting(key: str, value: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at)\n            VALUES (?, ?, CURRENT_TIMESTAMP)\n        ', (key, value))
        conn.commit()
        return True
    except:
        return False
    finally:
        conn.close()

# ── Developer revenue share (default 10%) ─────────────────────────

def get_dev_share_percent() -> float:
    try:
        return max(0.0, min(100.0, float(get_system_setting('dev_share_percent', '10') or 10)))
    except (TypeError, ValueError):
        return 10.0

def _dev_share_float(key: str, default: float = 0.0) -> float:
    try:
        return float(get_system_setting(key, str(default)) or default)
    except (TypeError, ValueError):
        return default

def _set_dev_share_float(key: str, value: float) -> None:
    set_system_setting(key, f'{round(float(value), 2):.2f}')

def ensure_dev_share_bootstrapped() -> None:
    """One-time: seed balance from historical revenue * percent.

    Revenue = successful deposits + abs(successful CloudPayments auto-extends).
    Balance top-ups that later buy subscriptions are counted once (at deposit).
    """
    if get_system_setting('dev_share_bootstrapped', '0') == '1':
        return
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE type = 'deposit' AND status = 'Success'
            """
        )
        deposits = float(cursor.fetchone()['total'] or 0)
        cursor.execute(
            """
            SELECT COALESCE(SUM(ABS(amount)), 0) AS total
            FROM transactions
            WHERE type = 'subscription_extend' AND status = 'Success'
              AND payment_provider = 'CloudPayments'
            """
        )
        extends = float(cursor.fetchone()['total'] or 0)
        revenue = deposits + extends
        percent = get_dev_share_percent()
        share = round(revenue * percent / 100.0, 2)
        _set_dev_share_float('dev_share_balance', share)
        _set_dev_share_float('dev_share_total_accrued', share)
        _set_dev_share_float('dev_share_total_paid', 0.0)
        set_system_setting('dev_share_bootstrapped', '1')
        if share > 0:
            cursor.execute(
                """
                INSERT INTO developer_share_ledger (entry_type, amount, balance_after, note)
                VALUES ('bootstrap', ?, ?, ?)
                """,
                (
                    share,
                    share,
                    f'Начальный расчёт {percent}% от дохода {revenue:.2f}₽ '
                    f'(депозиты {deposits:.2f}₽ + автопродления {extends:.2f}₽)',
                ),
            )
            conn.commit()
        logger.info(
            'Developer share bootstrapped: balance=%s from revenue=%s (deposits=%s extends=%s)',
            share, revenue, deposits, extends,
        )
    except Exception as e:
        logger.error('Developer share bootstrap failed: %s', e)
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        conn.close()

def get_developer_share_snapshot() -> Dict[str, Any]:
    ensure_dev_share_bootstrapped()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT id, entry_type, amount, balance_after, source_transaction_id, note, created_at
            FROM developer_share_ledger
            ORDER BY id DESC
            LIMIT 30
            """
        )
        ledger = [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()
    return {
        'percent': get_dev_share_percent(),
        'balance': round(_dev_share_float('dev_share_balance'), 2),
        'total_accrued': round(_dev_share_float('dev_share_total_accrued'), 2),
        'total_paid': round(_dev_share_float('dev_share_total_paid'), 2),
        'ledger': ledger,
    }

def accrue_developer_share(revenue_amount: float, source_transaction_id: int = None, note: str = '') -> float:
    """Accrue percent of real revenue onto developer balance. Returns accrued share."""
    ensure_dev_share_bootstrapped()
    revenue_amount = float(revenue_amount or 0)
    if revenue_amount <= 0:
        return 0.0
    percent = get_dev_share_percent()
    share = round(revenue_amount * percent / 100.0, 2)
    if share <= 0:
        return 0.0
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('BEGIN IMMEDIATE')
        bal = _dev_share_float('dev_share_balance')
        accrued = _dev_share_float('dev_share_total_accrued')
        # re-read inside tx via SQL for consistency
        cursor.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'dev_share_balance'")
        row = cursor.fetchone()
        bal = float(row['setting_value']) if row else bal
        cursor.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'dev_share_total_accrued'")
        row = cursor.fetchone()
        accrued = float(row['setting_value']) if row else accrued
        new_bal = round(bal + share, 2)
        new_accrued = round(accrued + share, 2)
        cursor.execute(
            'INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            ('dev_share_balance', f'{new_bal:.2f}'),
        )
        cursor.execute(
            'INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            ('dev_share_total_accrued', f'{new_accrued:.2f}'),
        )
        cursor.execute(
            """
            INSERT INTO developer_share_ledger (entry_type, amount, balance_after, source_transaction_id, note)
            VALUES ('accrual', ?, ?, ?, ?)
            """,
            (share, new_bal, source_transaction_id, note or f'{percent}% от дохода {revenue_amount:.2f}₽'),
        )
        conn.commit()
        return share
    except Exception as e:
        logger.error('accrue_developer_share error: %s', e)
        try:
            conn.rollback()
        except Exception:
            pass
        return 0.0
    finally:
        conn.close()

def clawback_developer_share(revenue_amount: float, source_transaction_id: int = None, note: str = '') -> float:
    """Reduce developer balance after a refund (up to available balance)."""
    ensure_dev_share_bootstrapped()
    revenue_amount = float(revenue_amount or 0)
    if revenue_amount <= 0:
        return 0.0
    percent = get_dev_share_percent()
    share = round(revenue_amount * percent / 100.0, 2)
    if share <= 0:
        return 0.0
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('BEGIN IMMEDIATE')
        cursor.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'dev_share_balance'")
        row = cursor.fetchone()
        bal = float(row['setting_value']) if row else 0.0
        claw = min(share, bal)
        if claw <= 0:
            conn.rollback()
            return 0.0
        new_bal = round(bal - claw, 2)
        cursor.execute(
            'INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            ('dev_share_balance', f'{new_bal:.2f}'),
        )
        cursor.execute(
            """
            INSERT INTO developer_share_ledger (entry_type, amount, balance_after, source_transaction_id, note)
            VALUES ('clawback', ?, ?, ?, ?)
            """,
            (-claw, new_bal, source_transaction_id, note or f'Коррекция после возврата {revenue_amount:.2f}₽'),
        )
        conn.commit()
        return claw
    except Exception as e:
        logger.error('clawback_developer_share error: %s', e)
        try:
            conn.rollback()
        except Exception:
            pass
        return 0.0
    finally:
        conn.close()

def payout_developer_share(amount: float, note: str = '') -> Tuple[bool, str, float]:
    """Mark a developer payout: decrease unpaid balance. Returns (ok, error, new_balance)."""
    ensure_dev_share_bootstrapped()
    try:
        amount = round(float(amount), 2)
    except (TypeError, ValueError):
        return False, 'Некорректная сумма', 0.0
    if amount <= 0:
        return False, 'Сумма должна быть больше 0', 0.0
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('BEGIN IMMEDIATE')
        cursor.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'dev_share_balance'")
        row = cursor.fetchone()
        bal = float(row['setting_value']) if row else 0.0
        if amount > bal + 0.001:
            conn.rollback()
            return False, f'Недостаточно: на балансе {bal:.2f}₽', bal
        cursor.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'dev_share_total_paid'")
        row = cursor.fetchone()
        paid = float(row['setting_value']) if row else 0.0
        new_bal = round(bal - amount, 2)
        new_paid = round(paid + amount, 2)
        cursor.execute(
            'INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            ('dev_share_balance', f'{new_bal:.2f}'),
        )
        cursor.execute(
            'INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            ('dev_share_total_paid', f'{new_paid:.2f}'),
        )
        cursor.execute(
            """
            INSERT INTO developer_share_ledger (entry_type, amount, balance_after, note)
            VALUES ('payout', ?, ?, ?)
            """,
            (-amount, new_bal, note or f'Выплата разработчику {amount:.2f}₽'),
        )
        conn.commit()
        return True, '', new_bal
    except Exception as e:
        logger.error('payout_developer_share error: %s', e)
        try:
            conn.rollback()
        except Exception:
            pass
        return False, str(e), 0.0
    finally:
        conn.close()

def get_default_squads(plan_type: str='vpn') -> List[str]:
    import json
    value = get_system_setting(f'default_squads_{plan_type}', '[]')
    try:
        return json.loads(value)
    except:
        return []

def set_default_squads(squad_uuids: List[str], plan_type: str='vpn') -> bool:
    import json
    return set_system_setting(f'default_squads_{plan_type}', json.dumps(list(dict.fromkeys(squad_uuids))))

def check_referral_rate_limit(referrer_telegram_id: int, limit: int=25, window_seconds: int=60) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cutoff = datetime.now() - timedelta(seconds=window_seconds)
        cursor.execute('\n            SELECT COUNT(*) FROM users\n            WHERE referred_by = (SELECT id FROM users WHERE telegram_id = ?)\n            AND registration_date > ?\n        ', (referrer_telegram_id, cutoff.isoformat()))
        return cursor.fetchone()[0] < limit
    finally:
        conn.close()

def set_referrer_for_user(user_id: int, referrer_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT referred_by FROM users WHERE id = ?', (user_id,))
        row = cursor.fetchone()
        if not row or row['referred_by'] is not None:
            return False
        cursor.execute('UPDATE users SET referred_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', (referrer_id, user_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def get_user_by_referral_code(referral_code: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM users WHERE referral_code = ?', (referral_code,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def credit_referral_income(user_id: int, purchase_amount: float, description: str=None, payment_id: str=None) -> Optional[Dict]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT u.id, u.username, u.referred_by,\n                   r.id as referrer_id, r.telegram_id as referrer_telegram_id,\n                   r.partner_rate, r.username as referrer_username\n            FROM users u LEFT JOIN users r ON u.referred_by = r.id\n            WHERE u.id = ?\n        ', (user_id,))
        row = cursor.fetchone()
        if not row or not row['referrer_id']:
            return None
        referrer_id = row['referrer_id']
        # Защита от двойного начисления по одному payment_id
        if payment_id:
            cursor.execute(
                "SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND type = 'referral_income' AND description LIKE ?",
                (referrer_id, f'%#{payment_id}%'),
            )
            if cursor.fetchone()['count'] > 0:
                return None
        # 30% от суммы покупки
        # (дубликат по конкретной транзакции контролирует вызывающий код через payment_id)
        # 30% от суммы покупки
        rate_pct = float(row['partner_rate'] or 30)
        income = round(float(purchase_amount or 0) * rate_pct / 100, 2)
        if income <= 0:
            return None
        cursor.execute('\n            UPDATE users SET partner_balance = COALESCE(partner_balance, 0) + ?,\n                           total_earned = total_earned + ?,\n                           updated_at = CURRENT_TIMESTAMP WHERE id = ?\n        ', (income, income, referrer_id))
        pid_suffix = f' [#{payment_id}]' if payment_id else ''
        desc = description or f"Доход от реферала @{row['username'] or user_id}: {income:.0f}₽ ({rate_pct:.0f}% от {purchase_amount:.0f}₽){pid_suffix}"
        cursor.execute("\n            INSERT INTO transactions (user_id, type, amount, status, description)\n            VALUES (?, 'referral_income', ?, 'Success', ?)\n        ", (referrer_id, income, desc))
        conn.commit()
        return {'referrer_id': referrer_id, 'referrer_telegram_id': row['referrer_telegram_id'], 'income': income, 'rate': rate_pct, 'purchase_amount': purchase_amount}
    except Exception as e:
        logger.error(f'Referral income error: {e}')
        conn.rollback()
        return None
    finally:
        conn.close()

def migrate_partner_balance_to_balance(user_id: int) -> float:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT partner_balance FROM users WHERE id = ?', (user_id,))
        row = cursor.fetchone()
        if not row or not row['partner_balance'] or row['partner_balance'] <= 0:
            return 0.0
        amount = float(row['partner_balance'])
        cursor.execute('\n            UPDATE users SET balance = balance + ?, partner_balance = 0,\n                           updated_at = CURRENT_TIMESTAMP WHERE id = ?\n        ', (amount, user_id))
        cursor.execute("\n            INSERT INTO transactions (user_id, type, amount, status, description)\n            VALUES (?, 'transfer', ?, 'Success', 'Перенос реферального баланса на основной')\n        ", (user_id, amount))
        conn.commit()
        return amount
    except Exception as e:
        logger.error(f'Partner balance migration error: {e}')
        conn.rollback()
        return 0.0
    finally:
        conn.close()

def deduct_partner_balance(user_id: int, amount: float) -> bool:
    if amount <= 0:
        return False
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('BEGIN IMMEDIATE')
        cursor.execute('\n            UPDATE users\n            SET partner_balance = partner_balance - ?,\n                updated_at = CURRENT_TIMESTAMP\n            WHERE id = ? AND COALESCE(partner_balance, 0) >= ?\n            ', (amount, user_id, amount))
        if cursor.rowcount == 0:
            conn.rollback()
            return False
        conn.commit()
        return True
    except Exception as e:
        logger.error(f'Deduct partner balance error: {e}')
        conn.rollback()
        return False
    finally:
        conn.close()

PARTNER_WITHDRAW_MAX_RUB = 5000
PARTNER_WITHDRAW_COOLDOWN_SECONDS = 86400

def validate_partner_withdraw_amount(amount: float) -> bool:
    return amount > 0 and amount <= PARTNER_WITHDRAW_MAX_RUB

def get_partner_withdrawal_cooldown(user_id: int, cooldown_seconds: int = PARTNER_WITHDRAW_COOLDOWN_SECONDS) -> Optional[dict]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT created_at FROM transactions
            WHERE user_id = ?
              AND type = 'withdrawal_request'
              AND datetime(created_at) >= datetime('now', ?)
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (user_id, f'-{int(cooldown_seconds)} seconds'),
        )
        row = cursor.fetchone()
        if not row:
            return None
        from datetime import datetime, timedelta
        last_raw = row['created_at']
        if isinstance(last_raw, str):
            last_at = datetime.fromisoformat(last_raw.replace('Z', '+00:00')).replace(tzinfo=None)
        else:
            last_at = last_raw.replace(tzinfo=None) if getattr(last_raw, 'tzinfo', None) else last_raw
        next_allowed = last_at + timedelta(seconds=cooldown_seconds)
        seconds_left = int((next_allowed - datetime.now()).total_seconds())
        if seconds_left <= 0:
            return None
        return {'seconds_left': seconds_left}
    finally:
        conn.close()

def prepare_partner_withdrawal(
    user_id: int,
    amount: float,
    description: str,
    payment_method: str,
    cooldown_seconds: int = PARTNER_WITHDRAW_COOLDOWN_SECONDS,
) -> tuple[Optional[int], Optional[str]]:
    if not validate_partner_withdraw_amount(amount):
        return None, 'invalid_amount'
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('BEGIN IMMEDIATE')
        cursor.execute(
            """
            SELECT 1 FROM transactions
            WHERE user_id = ?
              AND type = 'withdrawal_request'
              AND datetime(created_at) >= datetime('now', ?)
            LIMIT 1
            """,
            (user_id, f'-{int(cooldown_seconds)} seconds'),
        )
        if cursor.fetchone():
            conn.rollback()
            return None, 'rate_limit'
        cursor.execute(
            """
            UPDATE users
            SET partner_balance = partner_balance - ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND COALESCE(partner_balance, 0) >= ?
            """,
            (amount, user_id, amount),
        )
        if cursor.rowcount == 0:
            conn.rollback()
            return None, 'insufficient'
        cursor.execute(
            """
            INSERT INTO transactions (user_id, type, amount, status, description, payment_method)
            VALUES (?, 'withdrawal_request', ?, 'Pending', ?, ?)
            """,
            (user_id, -amount, description, payment_method),
        )
        transaction_id = cursor.lastrowid
        conn.commit()
        return transaction_id, None
    except Exception as e:
        logger.error(f'Prepare partner withdrawal error: {e}')
        conn.rollback()
        return None, 'db_error'
    finally:
        conn.close()

def refund_partner_balance(user_id: int, amount: float) -> bool:
    if amount <= 0:
        return False
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            UPDATE users\n            SET partner_balance = COALESCE(partner_balance, 0) + ?,\n                updated_at = CURRENT_TIMESTAMP\n            WHERE id = ?\n            ', (amount, user_id))
        conn.commit()
        return cursor.rowcount > 0
    except Exception as e:
        logger.error(f'Refund partner balance error: {e}')
        conn.rollback()
        return False
    finally:
        conn.close()

def set_partner_balance(user_id: int, amount: float) -> bool:
    if amount < 0:
        return False
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE users
            SET partner_balance = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (round(float(amount), 2), user_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    except Exception as e:
        logger.error(f'Set partner balance error: {e}')
        conn.rollback()
        return False
    finally:
        conn.close()

def is_referral_withdraw_blocked(user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT COALESCE(referral_withdraw_blocked, 0) AS blocked FROM users WHERE id = ?', (user_id,))
        row = cursor.fetchone()
        return bool(row and row['blocked'])
    finally:
        conn.close()

def set_referral_withdraw_blocked(user_id: int, blocked: bool) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE users
            SET referral_withdraw_blocked = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (1 if blocked else 0, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    except Exception as e:
        logger.error(f'Set referral withdraw blocked error: {e}')
        conn.rollback()
        return False
    finally:
        conn.close()

def get_referrer_info(user_id: int) -> Optional[Dict]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT r.id, r.telegram_id, r.username, r.full_name\n            FROM users u JOIN users r ON u.referred_by = r.id WHERE u.id = ?\n        ', (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def get_all_squad_configs() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM squad_configs ORDER BY squad_type, priority DESC')
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()

def get_squads_for_subscription(subscription_type: str) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT sc.* FROM squad_configs sc\n            JOIN subscription_squad_mapping ssm ON sc.squad_uuid = ssm.squad_uuid\n            WHERE ssm.subscription_type = ? AND ssm.is_active = 1 AND sc.is_active = 1\n            ORDER BY sc.priority DESC, sc.current_users ASC\n        ', (subscription_type,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()

def get_best_squad_for_subscription(subscription_type: str) -> Optional[Dict[str, Any]]:
    squads = get_squads_for_subscription(subscription_type)
    if not squads:
        return None
    available = [s for s in squads if s['max_users'] == 0 or s['current_users'] < s['max_users']]
    if not available:
        available = squads
    return min(available, key=lambda s: s['current_users'])

def update_squad_user_count(squad_uuid: str, delta: int=1) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            UPDATE squad_configs SET current_users = MAX(0, current_users + ?),\n                                    updated_at = CURRENT_TIMESTAMP WHERE squad_uuid = ?\n        ', (delta, squad_uuid))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def upsert_squad_config(squad_uuid: str, squad_name: str, squad_type: str, max_users: int=0, priority: int=0) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            INSERT INTO squad_configs (squad_uuid, squad_name, squad_type, max_users, priority)\n            VALUES (?, ?, ?, ?, ?)\n            ON CONFLICT(squad_uuid) DO UPDATE SET\n                squad_name = excluded.squad_name, squad_type = excluded.squad_type,\n                max_users = excluded.max_users, priority = excluded.priority,\n                updated_at = CURRENT_TIMESTAMP\n        ', (squad_uuid, squad_name, squad_type, max_users, priority))
        conn.commit()
        return True
    except:
        return False
    finally:
        conn.close()

def sync_squad_user_counts() -> None:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("\n            SELECT squad_uuid, COUNT(*) as cnt FROM vpn_keys \n            WHERE squad_uuid IS NOT NULL AND status = 'Active' GROUP BY squad_uuid\n        ")
        counts = {row['squad_uuid']: row['cnt'] for row in cursor.fetchall()}
        cursor.execute('SELECT squad_uuid FROM squad_configs')
        for row in cursor.fetchall():
            cursor.execute('UPDATE squad_configs SET current_users = ?, updated_at = CURRENT_TIMESTAMP WHERE squad_uuid = ?', (counts.get(row['squad_uuid'], 0), row['squad_uuid']))
        conn.commit()
    except Exception as e:
        logger.error(f'Sync squad counts error: {e}')
        conn.rollback()
    finally:
        conn.close()

def get_subscription_squad_mapping() -> Dict[str, List[str]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT subscription_type, squad_uuid FROM subscription_squad_mapping WHERE is_active = 1')
        result = {'vpn': [], 'whitelist': [], 'trial': []}
        for row in cursor.fetchall():
            if row['subscription_type'] in result:
                result[row['subscription_type']].append(row['squad_uuid'])
        return result
    finally:
        conn.close()

def set_subscription_squads(subscription_type: str, squad_uuids: List[str]) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM subscription_squad_mapping WHERE subscription_type = ?', (subscription_type,))
        for uuid in squad_uuids:
            cursor.execute('INSERT INTO subscription_squad_mapping (subscription_type, squad_uuid) VALUES (?, ?)', (subscription_type, uuid))
        conn.commit()
        return True
    except:
        conn.rollback()
        return False
    finally:
        conn.close()

def create_panel_admin(username: str, password: str) -> Optional[int]:
    import secrets
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256(f'{salt}:{password}'.encode()).hexdigest()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('INSERT INTO panel_admins (username, password_hash) VALUES (?, ?)', (username, f'{salt}:{password_hash}'))
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def verify_panel_admin(username: str, password: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT id, username, password_hash, is_active FROM panel_admins WHERE username = ? AND is_active = 1', (username,))
        row = cursor.fetchone()
        if not row:
            return None
        salt, expected = row['password_hash'].split(':', 1)
        computed = hashlib.sha256(f'{salt}:{password}'.encode()).hexdigest()
        if computed != expected:
            return None
        cursor.execute('UPDATE panel_admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?', (row['id'],))
        conn.commit()
        return {'id': row['id'], 'username': row['username']}
    finally:
        conn.close()

def create_panel_session(admin_id: int) -> Optional[str]:
    import secrets
    token = secrets.token_urlsafe(32)
    expires = datetime.now() + timedelta(days=7)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM panel_sessions WHERE admin_id = ?', (admin_id,))
        cursor.execute('INSERT INTO panel_sessions (admin_id, session_token, expires_at) VALUES (?, ?, ?)', (admin_id, token, expires.isoformat()))
        conn.commit()
        return token
    except:
        return None
    finally:
        conn.close()

def verify_panel_session(session_token: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT ps.*, pa.username FROM panel_sessions ps\n            JOIN panel_admins pa ON ps.admin_id = pa.id\n            WHERE ps.session_token = ? AND ps.expires_at > CURRENT_TIMESTAMP AND pa.is_active = 1\n        ', (session_token,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def delete_panel_session(session_token: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM panel_sessions WHERE session_token = ?', (session_token,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def create_miniapp_session(telegram_id: int=None, username: str | None=None, first_name: str | None=None, photo_url: str | None=None, days: int=30, user_id: int=None) -> Optional[str]:
    token = secrets.token_urlsafe(32)
    expires = datetime.now() + timedelta(days=days)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if user_id is not None:
            cursor.execute('DELETE FROM miniapp_sessions WHERE user_id = ?', (user_id,))
        if telegram_id is not None:
            cursor.execute('DELETE FROM miniapp_sessions WHERE telegram_id = ?', (telegram_id,))
        cursor.execute('\n            INSERT INTO miniapp_sessions\n                (user_id, telegram_id, session_token, username, first_name, photo_url, expires_at)\n            VALUES (?, ?, ?, ?, ?, ?, ?)\n            ', (user_id, telegram_id, token, username, first_name, photo_url, expires.isoformat()))
        conn.commit()
        return token
    except Exception:
        return None
    finally:
        conn.close()

def verify_miniapp_session(session_token: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT * FROM miniapp_sessions\n            WHERE session_token = ? AND expires_at > CURRENT_TIMESTAMP\n            ', (session_token,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def delete_miniapp_session(session_token: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM miniapp_sessions WHERE session_token = ?', (session_token,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def create_email_otp(email: str, purpose: str, user_id: int=None, payload: str=None, ip_address: str=None, ttl_minutes: int=10) -> Optional[str]:
    email_norm = (email or '').strip().lower()
    if not email_norm:
        return None
    code = f'{secrets.randbelow(1000000):06d}'
    code_hash = hashlib.sha256(code.encode()).hexdigest()
    expires = datetime.now() + timedelta(minutes=ttl_minutes)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE email_otps SET used_at = CURRENT_TIMESTAMP WHERE email = ? AND purpose = ? AND used_at IS NULL",
            (email_norm, purpose),
        )
        cursor.execute(
            """
            INSERT INTO email_otps (email, code_hash, purpose, user_id, payload, ip_address, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (email_norm, code_hash, purpose, user_id, payload, ip_address, expires.isoformat()),
        )
        conn.commit()
        return code
    except Exception as e:
        logger.error(f'create_email_otp failed: {e}')
        return None
    finally:
        conn.close()

def count_recent_email_otps(email: str, purpose: str=None, window_seconds: int=60) -> int:
    email_norm = (email or '').strip().lower()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        since = (datetime.now() - timedelta(seconds=window_seconds)).isoformat()
        if purpose:
            cursor.execute(
                'SELECT COUNT(*) AS cnt FROM email_otps WHERE email = ? AND purpose = ? AND created_at >= ?',
                (email_norm, purpose, since),
            )
        else:
            cursor.execute(
                'SELECT COUNT(*) AS cnt FROM email_otps WHERE email = ? AND created_at >= ?',
                (email_norm, since),
            )
        return int(cursor.fetchone()['cnt'] or 0)
    finally:
        conn.close()

def verify_email_otp(email: str, purpose: str, code: str, max_attempts: int=5) -> Tuple[bool, Optional[Dict[str, Any]], str]:
    email_norm = (email or '').strip().lower()
    code_hash = hashlib.sha256((code or '').encode()).hexdigest()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT * FROM email_otps
            WHERE email = ? AND purpose = ? AND used_at IS NULL
            ORDER BY id DESC LIMIT 1
            """,
            (email_norm, purpose),
        )
        row = cursor.fetchone()
        if not row:
            return (False, None, 'Код не найден или уже использован')
        otp = dict(row)
        if otp.get('expires_at') and str(otp['expires_at']) < datetime.now().isoformat():
            return (False, None, 'Код истёк')
        attempts = int(otp.get('attempts') or 0)
        if attempts >= max_attempts:
            return (False, None, 'Слишком много попыток')
        if otp['code_hash'] != code_hash:
            cursor.execute('UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?', (otp['id'],))
            conn.commit()
            return (False, None, 'Неверный код')
        cursor.execute('UPDATE email_otps SET used_at = CURRENT_TIMESTAMP, attempts = attempts + 1 WHERE id = ?', (otp['id'],))
        conn.commit()
        return (True, otp, '')
    finally:
        conn.close()

def create_pending_account_link(
    initiator_user_id: int,
    other_user_id: int,
    link_type: str,
    link_email: str=None,
    link_telegram_id: int=None,
    link_password_hash: str=None,
    payload: str=None,
    status: str='awaiting_choice',
) -> Optional[int]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE pending_account_links SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE initiator_user_id = ? AND status IN ('awaiting_choice', 'awaiting_confirm')",
            (initiator_user_id,),
        )
        cursor.execute(
            """
            INSERT INTO pending_account_links
                (initiator_user_id, other_user_id, link_type, status, link_email, link_telegram_id, link_password_hash, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (initiator_user_id, other_user_id, link_type, status, (link_email or '').strip().lower() or None, link_telegram_id, link_password_hash, payload),
        )
        conn.commit()
        return cursor.lastrowid
    except Exception as e:
        logger.error(f'create_pending_account_link failed: {e}')
        return None
    finally:
        conn.close()

def get_pending_account_link_for_user(user_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT * FROM pending_account_links
            WHERE (initiator_user_id = ? OR other_user_id = ?)
              AND status IN ('awaiting_choice', 'awaiting_confirm')
            ORDER BY id DESC LIMIT 1
            """,
            (user_id, user_id),
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def get_pending_account_link(link_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM pending_account_links WHERE id = ?', (link_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def update_pending_account_link(link_id: int, **kwargs) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        allowed = ['status', 'chosen_primary_user_id', 'link_email', 'link_telegram_id', 'link_password_hash', 'payload']
        updates = []
        values = []
        for k, v in kwargs.items():
            if k in allowed:
                updates.append(f'{k} = ?')
                values.append(v)
        if not updates:
            return False
        updates.append('updated_at = CURRENT_TIMESTAMP')
        values.append(link_id)
        cursor.execute(f"UPDATE pending_account_links SET {', '.join(updates)} WHERE id = ?", values)
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def transfer_user_assets(from_user_id: int, to_user_id: int) -> None:
    """Move balances, referrals, payments, keys ownership markers before deleting from_user."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('BEGIN IMMEDIATE')
        cursor.execute('SELECT balance, partner_balance, total_earned, trial_used FROM users WHERE id = ?', (from_user_id,))
        src = cursor.fetchone()
        if src:
            cursor.execute(
                """
                UPDATE users SET
                    balance = COALESCE(balance, 0) + ?,
                    partner_balance = COALESCE(partner_balance, 0) + ?,
                    total_earned = COALESCE(total_earned, 0) + ?,
                    trial_used = CASE WHEN trial_used = 1 OR ? = 1 THEN 1 ELSE 0 END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (src['balance'] or 0, src['partner_balance'] or 0, src['total_earned'] or 0, src['trial_used'] or 0, to_user_id),
            )
        cursor.execute('UPDATE users SET referred_by = ? WHERE referred_by = ?', (to_user_id, from_user_id))
        cursor.execute('UPDATE transactions SET user_id = ? WHERE user_id = ?', (to_user_id, from_user_id))
        cursor.execute('UPDATE saved_payment_methods SET user_id = ? WHERE user_id = ?', (to_user_id, from_user_id))
        cursor.execute('UPDATE recurring_subscriptions SET user_id = ? WHERE user_id = ?', (to_user_id, from_user_id))
        cursor.execute('UPDATE payment_intents SET user_id = ? WHERE user_id = ?', (to_user_id, from_user_id))
        cursor.execute('UPDATE promocode_uses SET user_id = ? WHERE user_id = ?', (to_user_id, from_user_id))
        cursor.execute('UPDATE mailing_deliveries SET user_id = ? WHERE user_id = ?', (to_user_id, from_user_id))
        cursor.execute('UPDATE miniapp_sessions SET user_id = ? WHERE user_id = ?', (to_user_id, from_user_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def get_or_create_default_admin() -> Dict[str, str]:
    import secrets
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT id, username FROM panel_admins WHERE is_active = 1 LIMIT 1')
        row = cursor.fetchone()
        if row:
            return {'username': row['username'], 'password': None, 'exists': True}
        username = 'admin'
        password = secrets.token_urlsafe(12)
        admin_id = create_panel_admin(username, password)
        if admin_id:
            return {'username': username, 'password': password, 'exists': False}
        return {'username': None, 'password': None, 'exists': False}
    finally:
        conn.close()

def update_admin_password(admin_id: int, new_password: str) -> bool:
    import secrets
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256(f'{salt}:{new_password}'.encode()).hexdigest()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('UPDATE panel_admins SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', (f'{salt}:{password_hash}', admin_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def get_users_referred_by(referrer_id: int) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('\n            SELECT id, telegram_id, username, full_name, registration_date, balance\n            FROM users WHERE referred_by = ?\n            ORDER BY id ASC\n        ', (referrer_id,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()

def count_users_referred_by(referrer_id: int) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT COUNT(*) AS cnt FROM users WHERE referred_by = ?', (referrer_id,))
        row = cursor.fetchone()
        return int(row['cnt']) if row else 0
    finally:
        conn.close()

def purge_user_from_database(user_id: int) -> List[str]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT key_uuid FROM vpn_keys WHERE user_id = ?', (user_id,))
        key_uuids = [row['key_uuid'] for row in cursor.fetchall() if row['key_uuid']]
        cursor.execute('DELETE FROM traffic_stats WHERE user_id = ? OR vpn_key_id IN (SELECT id FROM vpn_keys WHERE user_id = ?)', (user_id, user_id))
        cursor.execute('DELETE FROM promocode_uses WHERE user_id = ?', (user_id,))
        cursor.execute('DELETE FROM saved_payment_methods WHERE user_id = ?', (user_id,))
        cursor.execute('DELETE FROM transactions WHERE user_id = ?', (user_id,))
        cursor.execute('DELETE FROM mailing_deliveries WHERE user_id = ?', (user_id,))
        cursor.execute('DELETE FROM email_otps WHERE user_id = ?', (user_id,))
        cursor.execute("UPDATE pending_account_links SET status = 'cancelled' WHERE initiator_user_id = ? OR other_user_id = ?", (user_id, user_id))
        cursor.execute('DELETE FROM miniapp_sessions WHERE user_id = ?', (user_id,))
        cursor.execute('DELETE FROM vpn_keys WHERE user_id = ?', (user_id,))
        cursor.execute('UPDATE users SET referred_by = NULL WHERE referred_by = ?', (user_id,))
        cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
        conn.commit()
        return key_uuids
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def get_subscription_plan_distribution() -> Dict[str, Any]:
    import re
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("\n            SELECT duration_days, name FROM tariff_plans\n            WHERE plan_type = 'vpn' AND is_active = 1\n            ORDER BY sort_order ASC, duration_days ASC\n        ")
        plans = [dict(row) for row in cursor.fetchall()]
        buckets: Dict[int, Dict[str, Any]] = {p['duration_days']: {'label': p['name'], 'purchases': 0, 'users': set()} for p in plans}
        other = {'label': 'Другое', 'purchases': 0, 'users': set()}
        cursor.execute("\n            SELECT user_id, duration_days, description\n            FROM transactions\n            WHERE status = 'Success'\n              AND type IN ('subscription', 'subscription_extend')\n        ")
        def _parse_days(row) -> Optional[int]:
            if row['duration_days'] is not None:
                return int(row['duration_days'])
            desc = row['description'] or ''
            m = re.search('\\((\\d+)\\s*дн', desc, re.IGNORECASE)
            return int(m.group(1)) if m else None
        def _match_plan(days: int) -> Optional[int]:
            if days <= 1:
                return None
            for plan_days in buckets:
                if abs(plan_days - days) <= 2:
                    return plan_days
            return None
        for row in cursor.fetchall():
            days = _parse_days(row)
            if days is None:
                continue
            plan_key = _match_plan(days)
            if plan_key is not None:
                buckets[plan_key]['purchases'] += 1
                buckets[plan_key]['users'].add(row['user_id'])
            else:
                other['purchases'] += 1
                other['users'].add(row['user_id'])
        total_purchases = sum((b['purchases'] for b in buckets.values())) + other['purchases']
        items: List[Dict[str, Any]] = []
        for p in plans:
            d = int(p['duration_days'])
            b = buckets[d]
            pct = round(b['purchases'] / total_purchases * 100, 1) if total_purchases else 0.0
            items.append({'label': b['label'], 'durationDays': d, 'purchaseCount': b['purchases'], 'userCount': len(b['users']), 'percent': pct, 'value': b['purchases']})
        if other['purchases'] > 0:
            pct = round(other['purchases'] / total_purchases * 100, 1) if total_purchases else 0.0
            items.append({'label': other['label'], 'durationDays': None, 'purchaseCount': other['purchases'], 'userCount': len(other['users']), 'percent': pct, 'value': other['purchases']})
        total_users = len({uid for b in list(buckets.values()) + [other] for uid in b['users']})
        return {'items': items, 'totalPurchases': total_purchases, 'totalUsers': total_users}
    finally:
        conn.close()
def create_payment_intent(
    invoice_id: str,
    user_id: int,
    amount: float,
    days: int,
    plan_type: str = 'vpn_regular',
    tariff_category: str = 'regular',
    devices_limit: int = 2,
    is_trial: bool = False,
    action_type: str = 'wizard',
    vpn_key_id: Optional[int] = None,
) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO payment_intents (
                invoice_id, user_id, amount, days, plan_type, tariff_category,
                devices_limit, is_trial, action_type, vpn_key_id, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
            """,
            (
                invoice_id, user_id, float(amount), int(days), plan_type, tariff_category,
                int(devices_limit), 1 if is_trial else 0, action_type, vpn_key_id,
            ),
        )
        conn.commit()
        return True
    except Exception as e:
        logger.error('create_payment_intent error: %s', e)
        return False
    finally:
        conn.close()


def get_payment_intent(invoice_id: str) -> Optional[Dict[str, Any]]:
    if not invoice_id:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM payment_intents WHERE invoice_id = ?', (invoice_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def mark_payment_intent_paid(invoice_id: str, payment_id: Optional[str] = None) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE payment_intents
            SET status = 'paid', payment_id = COALESCE(?, payment_id), updated_at = CURRENT_TIMESTAMP
            WHERE invoice_id = ?
            """,
            (payment_id, invoice_id),
        )
        # Also allow inserting synthetic renew invoices
        if cursor.rowcount == 0 and payment_id:
            pass
        conn.commit()
        return True
    finally:
        conn.close()


def transaction_exists_by_payment_id(payment_id: str, provider: str = 'CloudPayments') -> bool:
    if not payment_id:
        return False
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT id FROM transactions WHERE payment_id = ? AND payment_provider = ?",
            (str(payment_id), provider),
        )
        return cursor.fetchone() is not None
    finally:
        conn.close()


def insert_deposit_transaction(
    user_id: int,
    amount: float,
    method_name: str,
    payment_id: str,
    provider: str = 'CloudPayments',
) -> Optional[int]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)
            VALUES (?, 'deposit', ?, 'Success', ?, ?, ?)
            """,
            (user_id, float(amount), method_name, provider, str(payment_id)),
        )
        tx_id = cursor.lastrowid
        conn.commit()
        return int(tx_id) if tx_id else None
    finally:
        conn.close()


def get_saved_payment_method(method_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM saved_payment_methods WHERE id = ?', (method_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_recurring_subscription(
    user_id: int,
    subscription_id: str,
    amount: float,
    duration_days: int,
    plan_type: str = 'vpn_regular',
    tariff_category: str = 'regular',
    devices_limit: int = 2,
    action_type: str = 'wizard',
    vpn_key_id: Optional[int] = None,
    card_token: Optional[str] = None,
    saved_method_id: Optional[int] = None,
    next_charge_at: Optional[str] = None,
    last_charge_at: Optional[str] = None,
    converts_from_trial: int = 0,
    status: str = 'ACTIVE',
) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Одна активная автопродление-подписка на пользователя: гасим старые
        cursor.execute(
            """
            UPDATE recurring_subscriptions
            SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND status IN ('PENDING', 'ACTIVE', 'PAST_DUE')
            """,
            (user_id,),
        )
        cursor.execute(
            """
            INSERT INTO recurring_subscriptions (
                user_id, subscription_id, status, amount, duration_days,
                plan_type, tariff_category, devices_limit, vpn_key_id,
                card_token, saved_method_id, next_charge_at, last_charge_at,
                converts_from_trial, action_type, retry_count, fail_notified
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
            """,
            (
                user_id, subscription_id, status, float(amount), int(duration_days),
                plan_type, tariff_category, int(devices_limit), vpn_key_id,
                card_token, saved_method_id, next_charge_at, last_charge_at,
                int(converts_from_trial), action_type,
            ),
        )
        conn.commit()
        return True
    except Exception as e:
        logger.error('create_recurring_subscription error: %s', e)
        return False
    finally:
        conn.close()


def get_recurring_subscription(subscription_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM recurring_subscriptions WHERE subscription_id = ?', (subscription_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_active_recurring_subscriptions_for_user(user_id: int) -> list:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT * FROM recurring_subscriptions
            WHERE user_id = ? AND status IN ('PENDING', 'ACTIVE', 'PAST_DUE')
            ORDER BY created_at DESC
            """,
            (user_id,),
        )
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


def get_due_recurring_subscriptions(limit: int = 40) -> list:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        now = datetime.utcnow().replace(microsecond=0).isoformat()
        cursor.execute(
            """
            SELECT * FROM recurring_subscriptions
            WHERE status IN ('ACTIVE', 'PAST_DUE')
              AND next_charge_at IS NOT NULL
              AND next_charge_at <= ?
            ORDER BY next_charge_at ASC
            LIMIT ?
            """,
            (now, int(limit)),
        )
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


def update_recurring_subscription(subscription_id: str, **kwargs) -> bool:
    allowed = {
        'status', 'next_charge_at', 'last_charge_at', 'vpn_key_id',
        'card_token', 'saved_method_id', 'retry_count', 'fail_notified',
        'converts_from_trial', 'amount', 'duration_days', 'plan_type',
        'tariff_category', 'devices_limit',
    }
    # next_charge_at может быть явно None (остановить ретраи)
    nullable = {'next_charge_at', 'vpn_key_id', 'card_token', 'saved_method_id'}
    fields = []
    values = []
    for key, value in kwargs.items():
        if key not in allowed:
            continue
        if value is None and key not in nullable:
            continue
        fields.append(f'{key} = ?')
        values.append(value)
    if not fields:
        return False
    fields.append('updated_at = CURRENT_TIMESTAMP')
    values.append(subscription_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            f"UPDATE recurring_subscriptions SET {', '.join(fields)} WHERE subscription_id = ?",
            tuple(values),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def link_recurring_subscription_to_vpn_key(user_id: int, vpn_key_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE recurring_subscriptions
            SET vpn_key_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
              AND status IN ('PENDING', 'ACTIVE', 'PAST_DUE')
              AND (vpn_key_id IS NULL OR vpn_key_id = 0)
            """,
            (vpn_key_id, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


# --- Legacy Platega helpers removed; use recurring_* ---


if __name__ != '__main__':
    init_database()
