import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Home, DollarSign, Users, Key, Mail, Gift, Settings, Menu, X,
  CheckCircle, AlertCircle, Search, Filter, ArrowUpRight, ArrowDownLeft,
  Activity, Loader, Ban, UserPlus, UserMinus, Clock, Edit2, Edit, Check, Copy,
  Smartphone, Database, Bell, Wallet, Plus, Lock, Send, Layers,
  Trash2, ChevronDown, Save, AlertTriangle, RefreshCw, BarChart2,
  Trophy, CreditCard, Link, Unlink, Shield, Wifi, Globe, Monitor,
  ChevronLeft, ExternalLink, Info, ToggleLeft, ToggleRight, Hash,
  Calendar, Percent
} from 'lucide-react';

// ─── ENV & API ────────────────────────────────────────────────────
declare const importMeta: any | undefined;
const rawEnv: any =
  (typeof importMeta !== 'undefined' && importMeta.env) ||
  (typeof (window as any) !== 'undefined' && (window as any).__ENV__) || {};

const BOT_USERNAME: string = rawEnv.VITE_BOT_USERNAME || 'onefederalbot';

function getPanelSecret(): string {
  return typeof window !== 'undefined' ? localStorage.getItem('panel_secret') || '' : '';
}
function setPanelSecret(s: string) { localStorage.setItem('panel_secret', s); }
function clearPanelSecret() { localStorage.removeItem('panel_secret'); }

const HTTP_STATUS_RU: Record<number, string> = {
  400: 'Некорректный запрос',
  401: 'Не авторизован',
  403: 'Доступ запрещён',
  404: 'Не найдено',
  409: 'Конфликт данных',
  422: 'Ошибка валидации',
  429: 'Слишком много запросов',
  500: 'Внутренняя ошибка сервера',
  502: 'Ошибка шлюза',
  503: 'Сервис недоступен',
  504: 'Таймаут шлюза',
};

function parseApiError(status: number, text: string): string {
  if (text) {
    try {
      const j = JSON.parse(text);
      const msg = j.error || j.message || j.detail || j.msg;
      if (msg && typeof msg === 'string') return msg;
    } catch {}
    // Если текст короткий и читабельный — показываем его
    if (text.length < 200 && !text.startsWith('{') && !text.startsWith('<')) return text;
  }
  return HTTP_STATUS_RU[status] || `Ошибка ${status}`;
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const url = `/api${path.startsWith('/') ? path : '/' + path}`;
  const headers: any = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (path.startsWith('/panel')) {
    const s = getPanelSecret();
    if (s) headers['Authorization'] = `Bearer ${s}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    // Only 401 logs out; 403 stays signed in and surfaces the error
    if (res.status === 401) { clearPanelSecret(); window.location.reload(); }
    const t = await res.text();
    throw new Error(parseApiError(res.status, t));
  }
  try { return await res.json(); } catch { return null; }
}

// ─── TYPES ───────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; title: string; message?: string; type: ToastType; }

interface DBUser {
  id: number; telegram_id: number | null; email?: string | null; username: string | null; full_name: string | null;
  balance: number; status: string; registration_date: string; paid_until: string | null;
  referral_code: string; referred_by: number | null;
  referrer_telegram_id: number | null; referrer_username: string | null; referrer_code: string | null;
  partner_rate: number; partner_balance: number; total_earned: number;
  is_partner: number; is_banned: number; ban_reason: string | null;
  referral_withdraw_blocked: number; in_blacklist: boolean; referrals_count: number;
  transactions: DBTransaction[]; db_keys: DBKey[];   remnawave_keys: RWKey[];
  payment_methods?: Array<{
    id: number; payment_provider: string; payment_method_id: string;
    payment_method_type?: string; card_last4?: string; card_brand?: string; created_at?: string;
  }>;
}

interface DBTransaction {
  id: number; type: string; amount: number; status: string;
  payment_method: string | null; payment_provider: string | null;
  description: string | null; created_at: string;
}

interface DBKey {
  id: number; key_uuid: string; status: string; expiry_date: string | null;
  traffic_used: number; traffic_limit: number; devices_limit: number;
  plan_type: string; created_at: string; last_used: string | null;
  last_ip: string | null; squad_uuid: string | null;
}

interface RWKey {
  uuid: string; short_uuid: string; username: string; status: string;
  expire_at: string | null; traffic_limit_bytes: number; traffic_used_bytes: number;
  lifetime_traffic_bytes: number; hwid_device_limit: number | null;
  subscription_url: string; online_at: string | null; first_connected_at: string | null;
  sub_last_user_agent: string | null; sub_last_opened_at: string | null;
  active_internal_squads: any[]; created_at: string | null; updated_at: string | null;
}

interface RWDevice {
  id?: string; hwid?: string; uuid?: string; userAgent?: string;
  ip?: string; createdAt?: string; updatedAt?: string;
  deviceName?: string; platform?: string;
}

interface PanelUser {
  id: number; telegram_id: number | null; email?: string | null; username: string | null; full_name: string | null;
  balance: number; status: string; registration_date: string; is_banned: number;
  in_blacklist: boolean; partner_balance: number; partner_rate: number;
}

// ─── UTILS ───────────────────────────────────────────────────────
const fmtN = (v: number | null | undefined) => (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const fmtM = (v: number | null | undefined) => `${fmtN(v)} ₽`;
const fmtGB = (bytes: number | null | undefined) => ((bytes ?? 0) / 1024 ** 3).toFixed(2) + ' ГБ';
const fmtDate = (s: string | null | undefined) => s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDateShort = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString('ru-RU') : '—';
const copyText = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});

function daysLeft(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

// ─── HOOKS ───────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((title: string, message?: string, type: ToastType = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);
  const remove = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, add, remove };
}

function useDebounce<T>(value: T, delay = 300): T {
  const [dv, setDv] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDv(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return dv;
}

// ─── PRIMITIVES ──────────────────────────────────────────────────
const Spinner: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <Loader size={size} className={`animate-spin faint ${className}`} />
);

const ToastContainer: React.FC<{ toasts: Toast[]; remove: (id: number) => void }> = ({ toasts, remove }) => (
  <div className="toasts">
    {toasts.map(t => (
      <div key={t.id} className={`toast ${t.type === 'error' ? 'error' : ''}`} role="alert">
        {t.type === 'error' ? <AlertCircle size={16} style={{ marginTop: 1 }} /> : <CheckCircle size={16} style={{ marginTop: 1 }} />}
        <div className="flex-1"><div className="toast-title">{t.title}</div>{t.message && <div className="toast-msg">{t.message}</div>}</div>
        <button style={{ background: 'none', border: 0, cursor: 'pointer', padding: 2 }} onClick={() => remove(t.id)}><X size={14} className="faint" /></button>
      </div>
    ))}
  </div>
);

const Modal: React.FC<{
  onClose: () => void; title?: React.ReactNode; icon?: React.ElementType;
  footer?: React.ReactNode; width?: number; children: React.ReactNode; z?: number;
}> = ({ onClose, title, icon: Icon, footer, width = 460, children, z = 60 }) => (
  <div className="modal-backdrop" style={{ zIndex: z }} onClick={onClose}>
    <div className="modal" style={{ maxWidth: width }} onClick={e => e.stopPropagation()}>
      {title != null && (
        <div className="modal-head">
          <div className="modal-title">{Icon && <Icon size={17} className="faint" />}{title}</div>
          <button className="icon-btn" onClick={onClose}><X size={17} /></button>
        </div>
      )}
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </div>
  </div>
);

const Toggle: React.FC<{ on: boolean; onChange: () => void }> = ({ on, onChange }) => (
  <button type="button" className={`toggle ${on ? 'on' : ''}`} onClick={onChange} aria-pressed={on}><span className="knob" /></button>
);

const Stat: React.FC<{ title: string; value: React.ReactNode; icon: React.ElementType; sub?: string }> =
  ({ title, value, icon: Icon, sub }) => (
    <div className="stat">
      <div className="stat-top"><span className="stat-label">{title}</span><Icon size={17} className="stat-ico" /></div>
      <div className="flex items-baseline gap-2"><span className="stat-value">{value}</span>{sub && <span className="stat-sub">{sub}</span>}</div>
    </div>
  );

const BarChart: React.FC<{ data: { label: string; value: number }[]; format?: (v: number) => string; height?: number }> =
  ({ data, format = String, height = 160 }) => {
    if (!data.length) return <p className="muted">Нет данных</p>;
    const max = Math.max(...data.map(d => d.value), 1);
    const maxIdx = data.reduce((mi, d, i, a) => d.value > a[mi].value ? i : mi, 0);
    return (
      <div className="bars" style={{ height }}>
        {data.map((d, i) => (
          <div className="bar-col" key={i} title={`${d.label}: ${format(d.value)}`}>
            <span className="bar-v">{d.value ? format(d.value) : ''}</span>
            <div className="bar-track"><div className={`bar ${i === maxIdx ? 'hot' : ''}`} style={{ height: `${Math.max(3, (d.value / max) * 100)}%` }} /></div>
            <span className="bar-x">{d.label}</span>
          </div>
        ))}
      </div>
    );
  };

// ─── LOGIN ────────────────────────────────────────────────────────
function LoginForm({ onLogin }: { onLogin: (s: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpId, setOtpId] = useState<number | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [initInfo, setInitInfo] = useState<{ username?: string; password?: string } | null>(null);

  useEffect(() => {
    fetch('/api/panel/auth/init').then(r => r.json()).then(d => {
      if (d.new_admin && d.password) setInitInfo({ username: d.username, password: d.password });
    }).catch(() => {});
  }, []);

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await fetch('/api/panel/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const d = await res.json();
      if (res.ok && d.requires_otp) { setOtpId(d.otp_id); }
      else if (res.ok && d.session_token) { setPanelSecret(d.session_token); onLogin(d.session_token); }
      else setError(d.error || 'Неверные данные');
    } catch { setError('Ошибка подключения'); }
    setLoading(false);
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await fetch('/api/panel/auth/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp_id: otpId, code: otpCode }) });
      const d = await res.json();
      if (res.ok) { setPanelSecret(d.session_token); onLogin(d.session_token); }
      else setError(d.error || 'Неверный код');
    } catch { setError('Ошибка подключения'); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 380, padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 44, height: 44, background: 'var(--surface-active)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}><Lock size={20} className="faint" /></div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>1FEDERAL Admin</div>
          <div className="sub" style={{ marginTop: 4 }}>Безопасный вход в панель</div>
        </div>
        {initInfo && (
          <div className="inset" style={{ padding: 14, marginBottom: 18 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Создан администратор</div>
            <div className="sub">Логин: <span className="mono">{initInfo.username}</span></div>
            <div className="sub">Пароль: <span className="mono">{initInfo.password}</span></div>
            <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Сохраните — пароль показывается один раз</div>
          </div>
        )}
        {!otpId ? (
          <form onSubmit={submitCredentials} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><label className="field-label">Логин</label><input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" required autoFocus /></div>
            <div><label className="field-label">Пароль</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required /></div>
            {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
            <button type="submit" className="btn solid block" disabled={loading || !username || !password}>{loading ? <Spinner size={15} /> : 'Войти'}</button>
          </form>
        ) : (
          <form onSubmit={submitOtp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="field-label">Код из Telegram</label>
              <input className="input center mono" type="text" value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" maxLength={6} autoFocus style={{ fontSize: 24, letterSpacing: 8 }} />
            </div>
            {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
            <button type="submit" className="btn solid block" disabled={loading || otpCode.length < 6}>{loading ? <Spinner size={15} /> : 'Подтвердить'}</button>
            <button type="button" className="btn ghost block" onClick={() => setOtpId(null)}>Назад</button>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────
const Dashboard: React.FC<{ onNavigate: (page: string) => void; onToast?: (t: string, m?: string, ty?: ToastType) => void }> = ({ onNavigate, onToast }) => {
  const [summary, setSummary] = useState<any>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutBusy, setPayoutBusy] = useState(false);

  const reload = useCallback(() => {
    apiFetch('/panel/stats/summary').then(d => d && setSummary(d)).catch(console.error);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const fmtM2 = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M ₽` : fmtM(v);
  const share = summary?.developer_share;

  const doPayout = async () => {
    const amount = Math.round(Number(payoutAmount) * 100) / 100;
    if (!amount || amount <= 0) {
      onToast?.('Укажите сумму', undefined, 'error');
      return;
    }
    if (!confirm(`Списать ${amount.toLocaleString('ru-RU')} ₽ с доли разработчика?`)) return;
    setPayoutBusy(true);
    try {
      const d = await apiFetch('/panel/developer-share/payout', {
        method: 'POST',
        body: JSON.stringify({ amount, note: `Выплата ${amount}₽` }),
      });
      onToast?.(d?.message || 'Списано');
      setPayoutAmount('');
      if (d?.developer_share) {
        setSummary((prev: any) => ({ ...prev, developer_share: d.developer_share }));
      } else {
        reload();
      }
    } catch (e: any) {
      onToast?.('Ошибка', e?.message || String(e), 'error');
    } finally {
      setPayoutBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 rise">
      <div>
        <div className="h-page">Панель управления</div>
        <div className="sub mt-1">Краткий обзор 1FEDERAL VPN</div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Stat title="Пользователи" value={summary ? fmtN(summary.total_users) : '—'} icon={Users} />
        <Stat title="Активные ключи" value={summary ? fmtN(summary.active_keys) : '—'} icon={Key} />
        <Stat title="Доход за месяц" value={summary ? fmtM2(summary.monthly_revenue) : '—'} icon={DollarSign} />
        <Stat title="Доход за сегодня" value={summary ? fmtM2(summary.today_revenue ?? 0) : '—'} icon={CreditCard} />
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="h-sec">Доля разработчика</h3>
            <div className="sub mt-1">{share ? `${share.percent}% от дохода проекта` : '10% от дохода проекта'}</div>
          </div>
          <div className="badge solid">{share ? fmtM2(share.balance) : '—'}</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div className="inset" style={{ padding: 12 }}>
            <div className="sub" style={{ fontSize: 11 }}>К выплате</div>
            <div style={{ fontWeight: 600, fontSize: 18, marginTop: 4 }}>{share ? fmtM2(share.balance) : '—'}</div>
          </div>
          <div className="inset" style={{ padding: 12 }}>
            <div className="sub" style={{ fontSize: 11 }}>Всего начислено</div>
            <div style={{ fontWeight: 600, fontSize: 18, marginTop: 4 }}>{share ? fmtM2(share.total_accrued) : '—'}</div>
          </div>
          <div className="inset" style={{ padding: 12 }}>
            <div className="sub" style={{ fontSize: 11 }}>Уже выплачено</div>
            <div style={{ fontWeight: 600, fontSize: 18, marginTop: 4 }}>{share ? fmtM2(share.total_paid) : '—'}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div style={{ flex: '1 1 140px' }}>
            <label className="field-label">Списать с баланса (когда заплатили)</label>
            <input
              className="input mono"
              type="number"
              min="0"
              step="0.01"
              placeholder="Сумма ₽"
              value={payoutAmount}
              onChange={e => setPayoutAmount(e.target.value)}
            />
          </div>
          <button className="btn solid" disabled={payoutBusy || !payoutAmount} onClick={doPayout}>
            {payoutBusy ? <Spinner size={14} /> : 'Списать'}
          </button>
          {share?.balance > 0 && (
            <button className="btn" type="button" onClick={() => setPayoutAmount(String(share.balance))}>
              Всё
            </button>
          )}
        </div>
        {(share?.ledger || []).length > 0 && (
          <div className="mt-4" style={{ maxHeight: 180, overflowY: 'auto' }}>
            <div className="sub mb-2" style={{ fontSize: 11 }}>Последние операции</div>
            {(share.ledger as any[]).slice(0, 8).map((row: any) => (
              <div key={row.id} className="flex justify-between gap-3" style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.entry_type === 'accrual' ? 'Начисление' : row.entry_type === 'payout' ? 'Выплата' : row.entry_type === 'clawback' ? 'Коррекция' : row.entry_type === 'bootstrap' ? 'Старт' : row.entry_type}
                  {row.note ? ` · ${row.note}` : ''}
                </span>
                <span className="mono" style={{ flex: 'none', color: row.amount >= 0 ? 'var(--text)' : 'var(--muted)' }}>
                  {row.amount > 0 ? '+' : ''}{Number(row.amount).toLocaleString('ru-RU')} ₽
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 className="h-sec mb-3">Быстрые разделы</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { page: 'Статистика', desc: 'Выручка, конверсия, рефералы', icon: BarChart2 },
            { page: 'Пользователи', desc: 'Поиск и управление аккаунтами', icon: Users },
            { page: 'Финансы', desc: 'Платежи и операции', icon: DollarSign },
          ].map(item => (
            <button
              key={item.page}
              className="btn"
              style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: 14, whiteSpace: 'normal' }}
              onClick={() => onNavigate(item.page)}
            >
              <item.icon size={16} className="faint" style={{ flexShrink: 0 }} />
              <span>
                <div style={{ fontWeight: 600 }}>{item.page}</div>
                <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>{item.desc}</div>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── FINANCE ──────────────────────────────────────────────────────
const FinancePage: React.FC<{ transactions: any[]; onSelect: (t: any) => void }> = ({ transactions, onSelect }) => {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => { apiFetch('/panel/finance/stats').then(d => d && setStats(d)).catch(console.error); }, []);
  return (
    <div className="flex flex-col gap-6 rise">
      <div><div className="h-page">Финансы</div><div className="sub mt-1">Доходы, операции и возвраты Т‑Банк</div></div>
      <div className="grid grid-cols-2 gap-4">
        <Stat title="Доход" value={stats ? fmtM(stats.deposits) : '—'} icon={ArrowUpRight} />
        <Stat title="Успешные платежи" value={stats ? fmtN(stats.successfulOps) : '—'} icon={Activity} sub="платежей" />
      </div>
      <div className="tbl-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>ID</th><th>Пользователь</th><th>Тип</th><th>Сумма</th><th>Способ</th><th>Дата</th></tr></thead>
            <tbody>
              {transactions.length === 0
                ? <tr className="empty-row"><td colSpan={6}>Пока нет операций</td></tr>
                : transactions.map(tx => {
                  const typeLabel = tx.type === 'trial' ? 'Пробная' : tx.type === 'subscription' ? 'Покупка' : tx.type === 'subscription_extend' ? 'Продление' : tx.type || '—';
                  return (
                  <tr key={tx.id} className="click" onClick={() => onSelect(tx)}>
                    <td className="muted mono">#{tx.id}</td>
                    <td className="muted">{tx.user}</td>
                    <td><span className={`badge ${tx.type === 'trial' ? 'line' : tx.type === 'subscription_extend' ? 'mute' : 'solid'}`}>{typeLabel}</span></td>
                    <td style={{ fontWeight: 600 }}>{Math.abs(tx.amount).toLocaleString('ru-RU')} ₽</td>
                    <td className="faint" style={{ fontSize: 12 }}>{tx.method}</td>
                    <td className="faint">{tx.date}</td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── TRANSACTION MODAL ───────────────────────────────────────────
const TransactionModal: React.FC<{ tx: any; onClose: () => void; onRefunded?: () => void; onToast?: (t: string, m?: string, ty?: ToastType) => void }> = ({ tx, onClose, onRefunded, onToast }) => {
  const [busy, setBusy] = useState(false);
  const canRefund = tx.amount > 0 && String(tx.status).toLowerCase() === 'success' && ['subscription', 'subscription_extend'].includes(tx.type);

  const doRefund = async () => {
    if (!canRefund || !confirm(`Вернуть ${tx.amount}₽ через Т‑Банк?`)) return;
    setBusy(true);
    try {
      const d = await apiFetch(`/panel/transactions/${tx.id}/refund`, { method: 'POST' });
      onToast?.(d?.message || 'Возврат выполнен');
      onRefunded?.();
      onClose();
    } catch (e: any) {
      onToast?.('Ошибка возврата', e?.message || String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={tx.amount > 0 ? 'Пополнение' : 'Списание'} icon={tx.amount > 0 ? ArrowUpRight : ArrowDownLeft} width={420}
      footer={<>
        {canRefund && (
          <button className="btn block danger" disabled={busy} onClick={doRefund}>
            {busy ? <Spinner size={14} /> : 'Вернуть через Т‑Банк'}
          </button>
        )}
        <button className="btn block" onClick={onClose}>Закрыть</button>
      </>}>
      {[['ID', `#${tx.id}`], ['Пользователь', tx.user], ['Сумма', `${tx.amount > 0 ? '+' : ''}${tx.amount} ₽`], ['Статус', tx.status], ['Метод', tx.method || '—'], ['Payment ID', tx.hash || tx.payment_id || '—'], ['Дата', tx.date]].map(([l, v]) => (
        <div key={String(l)} className="flex justify-between items-center" style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
          <span className="muted" style={{ fontSize: 13 }}>{l}</span>
          <span className="mono" style={{ fontSize: 13 }}>{v}</span>
        </div>
      ))}
    </Modal>
  );
};

// ─── STATISTICS ───────────────────────────────────────────────────
const StatisticsPage: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7' | '30' | '365'>('30');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(`/panel/statistics/full?period=${period}`)
      .then(d => { if (!cancelled && d) { setStats(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const fmtM2 = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M ₽` : fmtM(v);

  if (loading && !stats) return (
    <div className="flex flex-col gap-6 rise">
      <div><div className="h-page">Статистика</div></div>
      <div className="flex items-center justify-center" style={{ height: 200 }}><Spinner size={28} /></div>
    </div>
  );

  if (!stats) return (
    <div className="flex flex-col gap-6 rise">
      <div><div className="h-page">Статистика</div></div>
      <p className="muted">Не удалось загрузить данные</p>
    </div>
  );

  const revenueSeries = (() => {
    const raw = stats.revenueByDay ?? stats.dailyRevenue ?? stats.revenue_by_day ?? [];
    const labels = stats.revenueLabels ?? [];
    if (!Array.isArray(raw)) return [];
    if (raw.length && typeof raw[0] === 'number') return raw.map((v: number, i: number) => ({ label: labels[i] || String(i + 1), value: v }));
    return raw.map((d: any) => ({ label: String(d.label ?? d.date ?? d.day ?? ''), value: Number(d.value ?? d.amount ?? 0) }));
  })();

  return (
    <div className="flex flex-col gap-6 rise">
      <div><div className="h-page">Статистика</div><div className="sub mt-1">Детальная аналитика</div></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat title="Пользователей" value={fmtN(stats.totalUsers)} icon={Users} />
        <Stat title="Активных подписок" value={fmtN(stats.activeSubscriptions)} icon={Key} />
        <Stat title="Платежей сегодня" value={fmtN(stats.paymentsToday)} icon={CreditCard} />
        <Stat title="Баланс клиентов" value={fmtM2(stats.clientsBalance)} icon={Wallet} />
      </div>
      <div className="card" style={{ padding: 24 }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-5">
          <h3 className="h-sec">Выручка по дням</h3>
          <div className="seg" style={{ alignSelf: 'flex-start', overflowX: 'auto', maxWidth: '100%' }}>
            {([['7', 'Неделя'], ['30', '30 дней'], ['365', 'Год']] as const).map(([v, l]) => (
              <button key={v} className={`seg-item ${period === v ? 'on' : ''}`} onClick={() => setPeriod(v)}>{l}</button>
            ))}
          </div>
        </div>
        {revenueSeries.length > 0 && <BarChart data={revenueSeries} format={v => fmtM2(v)} height={200} />}
        <div className="grid grid-cols-2 gap-3 mt-5">
          <div className="inset" style={{ padding: 14 }}><div className="sub">В среднем в день</div><div className="stat-value mt-1">{fmtM2(stats.avgDaily || 0)}</div></div>
          <div className="inset" style={{ padding: 14 }}><div className="sub">Лучший день</div><div className="stat-value mt-1">{fmtM2(stats.bestDayValue || 0)}</div></div>
        </div>
      </div>
      <div className="card" style={{ padding: 24 }}>
        <h3 className="h-sec mb-4">Статистика подписок</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {[
            ['Всего', fmtN(stats.totalSubscriptions)],
            ['Платных', fmtN(stats.paidSubscriptions)],
            ['Истекших', fmtN(stats.expiredSubscriptions)],
            ['Новых сегодня', `+${fmtN(stats.newSubscriptionsToday)}`],
            ['За месяц', `+${fmtN(stats.boughtThisMonth)}`],
          ].map(([l, v]) => (
            <div key={String(l)} className="inset" style={{ padding: 14 }}>
              <div className="sub" style={{ fontSize: 11 }}>{l}</div>
              <div style={{ fontWeight: 600, fontSize: 17, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card" style={{ padding: 20 }}>
          <h3 className="h-sec mb-3">Конверсия Trial → Paid</h3>
          <div className="stat-value" style={{ fontSize: 36 }}>{stats.conversionRate?.toFixed(1) || 0}%</div>
          <div className="hbar mt-4"><i style={{ width: `${Math.min(stats.conversionRate || 0, 100)}%`, background: 'var(--text)' }} /></div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h3 className="h-sec mb-4">Рефералы</h3>
          {[['Приглашено', fmtN(stats.totalInvited)], ['Партнёров', fmtN(stats.partners)], ['Выплачено', fmtM2(stats.totalPaid)]].map(([l, v]) => (
            <div key={String(l)} className="flex justify-between" style={{ padding: '6px 0', fontSize: 14 }}><span className="muted">{l}</span><span style={{ fontWeight: 500 }}>{v}</span></div>
          ))}
        </div>
      </div>
      <div className="tbl-wrap">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}><h3 className="h-sec">Топ рефералов</h3></div>
        <table className="tbl">
          <thead><tr><th>Пользователь</th><th>Пригласил</th><th>Заработал</th></tr></thead>
          <tbody>
            {(stats.topReferrers || []).map((r: any) => (
              <tr key={r.id}><td><span className="flex items-center gap-2"><Trophy size={13} className="faint" />{r.name}</span></td><td className="muted">{r.count} чел.</td><td style={{ fontWeight: 500 }}>{fmtM(r.earned)}</td></tr>
            ))}
            {(!stats.topReferrers || !stats.topReferrers.length) && <tr className="empty-row"><td colSpan={3}>Нет данных</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── USER DETAIL PAGE ────────────────────────────────────────────
const UserDetailPage: React.FC<{
  userId: number;
  onBack: () => void;
  onToast: (t: string, m?: string, ty?: ToastType) => void;
}> = ({ userId, onBack, onToast }) => {
  const [user, setUser] = useState<DBUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [devicesMap, setDevicesMap] = useState<Record<string, RWDevice[]>>({});
  const [loadingDevices, setLoadingDevices] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'overview' | 'keys' | 'payments' | 'referrals'>('overview');

  // Inline edit state
  const [editRate, setEditRate] = useState('');
  const [editBalance, setEditBalance] = useState('');
  const [editReferrer, setEditReferrer] = useState('');
  const [editEmail, setEditEmail] = useState<string | null>(null);
  const [editTelegram, setEditTelegram] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Modals
  const [banModal, setBanModal] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [deleteModal, setDeleteModal] = useState(false);
  const [extendModal, setExtendModal] = useState<{ rw_uuid: string; current_expire: string | null } | null>(null);
  const [extendDays, setExtendDays] = useState('');
  const [reduceModal, setReduceModal] = useState<{ rw_uuid: string } | null>(null);
  const [reduceDays, setReduceDays] = useState('');
  const [trafficModal, setTrafficModal] = useState<{ rw_uuid: string; current_gb: number } | null>(null);
  const [trafficGb, setTrafficGb] = useState('');
  const [devicesModal, setDevicesModal] = useState<{ rw_uuid: string; current: number | null } | null>(null);
  const [devicesVal, setDevicesVal] = useState('');
  const [squadsModal, setSquadsModal] = useState<{ rw_uuid: string; current: string[] } | null>(null);
  const [selectedSquads, setSelectedSquads] = useState<string[]>([]);
  const [rwSquads, setRwSquads] = useState<{ uuid: string; name: string }[]>([]);
  const [notifMsg, setNotifMsg] = useState('');
  const [notifModal, setNotifModal] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch(`/panel/users/by-id/${userId}`);
      setUser(d);
      setEditRate(String(d.partner_rate ?? 30));
      setEditBalance(String(d.partner_balance ?? 0));
      // editEmail/editTelegram now open on demand (pencil icon)
    } catch (e: any) {
      onToast('Ошибка', e.message, 'error');
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    apiFetch('/panel/remnawave/squads')
      .then(d => setRwSquads(Array.isArray(d) ? d : []))
      .catch(() => setRwSquads([]));
  }, []);

  const squadName = (uuid: string) => rwSquads.find(s => s.uuid === uuid)?.name || uuid.slice(0, 8) + '…';

  const parseKeySquads = (raw: any): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map(s => (typeof s === 'string' ? s : s?.uuid)).filter(Boolean);
    }
    return [];
  };

  const update = async (field: string, value: any, extra?: Record<string, any>) => {
    if (!user) return;
    setSaving(field);
    try {
      await apiFetch(`/panel/users/${user.id}/update`, {
        method: 'POST',
        body: JSON.stringify({ field, value, ...extra }),
      });
      onToast('Сохранено', undefined, 'success');
      await reload();
    } catch (e: any) {
      onToast('Ошибка', e.message, 'error');
    }
    setSaving(null);
  };

  const loadDevices = async (rw_uuid: string, user_id: number) => {
    if (devicesMap[rw_uuid]) return;
    setLoadingDevices(prev => ({ ...prev, [rw_uuid]: true }));
    try {
      const d = await apiFetch(`/panel/users/${user_id}/remnawave-devices?rw_uuid=${rw_uuid}`);
      if (d && d.unsupported) {
        // Remnawave не поддерживает HWID-эндпоинт
        setDevicesMap(prev => ({ ...prev, [rw_uuid]: 'unsupported' as any }));
      } else {
        setDevicesMap(prev => ({ ...prev, [rw_uuid]: Array.isArray(d) ? d : [] }));
      }
    } catch {
      setDevicesMap(prev => ({ ...prev, [rw_uuid]: [] }));
    }
    setLoadingDevices(prev => ({ ...prev, [rw_uuid]: false }));
  };

  const deleteDevice = async (rw_uuid: string, hwid_uuid: string, user_id: number) => {
    try {
      await apiFetch(`/panel/users/${user_id}/remnawave-devices/${hwid_uuid}`, {
        method: 'DELETE',
        body: JSON.stringify({ rw_uuid }),
      });
      setDevicesMap(prev => ({ ...prev, [rw_uuid]: (prev[rw_uuid] || []).filter(d => (d.id || d.hwid || d.uuid) !== hwid_uuid) }));
      onToast('Устройство отвязано', undefined, 'success');
    } catch (e: any) {
      onToast('Ошибка', e.message, 'error');
    }
  };

  const sendNotif = async () => {
    if (!user || !notifMsg.trim()) return;
    try {
      await apiFetch(`/panel/users/${user.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'NOTIFY', value: notifMsg, notify: true }),
      });
      onToast('Сообщение отправлено', undefined, 'success');
      setNotifModal(false); setNotifMsg('');
    } catch (e: any) {
      onToast('Ошибка', e.message, 'error');
    }
  };

  if (loading) return (
    <div className="flex flex-col gap-4">
      <button className="btn ghost" style={{ width: 'fit-content' }} onClick={onBack}><ChevronLeft size={16} /> Назад</button>
      <div className="flex items-center justify-center" style={{ height: 200 }}><Spinner size={28} /></div>
    </div>
  );

  if (!user) return (
    <div className="flex flex-col gap-4">
      <button className="btn ghost" style={{ width: 'fit-content' }} onClick={onBack}><ChevronLeft size={16} /> Назад</button>
      <p className="muted">Пользователь не найден</p>
    </div>
  );

  const displayName = user.full_name || user.username || user.email || (user.telegram_id ? `id${user.telegram_id}` : `#${user.id}`);
  const isBanned = user.is_banned === 1 || user.in_blacklist;

  return (
    <div className="flex flex-col gap-6 rise">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <button className="btn ghost" onClick={onBack}><ChevronLeft size={16} /> Назад</button>
        <div className="flex-1 min-w-0">
          <div className="h-page">{displayName}</div>
          <div className="sub mt-1 flex items-center gap-3 flex-wrap">
            {user.username && <span>@{user.username}</span>}
            {user.email && <span className="mono">{user.email}</span>}
            {user.telegram_id != null && <span className="mono">tg:{user.telegram_id}</span>}
            <span className={`badge ${isBanned ? 'danger' : user.status === 'Active' ? 'solid' : 'mute'}`}>
              {isBanned ? 'Заблокирован' : user.status}
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn" onClick={() => setNotifModal(true)}><Bell size={15} /> Уведомление</button>
          {user.telegram_id != null && (
            <a className="btn" href={`?tg=${user.telegram_id}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Telegram</a>
          )}
          <a className="btn" href={`?uid=${user.id}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> UID</a>
        </div>
      </div>

      {/* Tabs */}
      <div className="seg">
        {(['overview', 'keys', 'payments', 'referrals'] as const).map(tab => {
          const labels = { overview: 'Обзор', keys: `Ключи (${user.remnawave_keys.length})`, payments: `Платежи (${user.transactions.length})`, referrals: `Рефералы (${user.referrals_count})` };
          return <button key={tab} className={`seg-item ${activeTab === tab ? 'on' : ''}`} onClick={() => setActiveTab(tab)}>{labels[tab]}</button>;
        })}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-4">
          {/* Identity */}
          <div className="card" style={{ padding: 20 }}>
            <h3 className="h-sec mb-4">Идентификация</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Static fields */}
              {[
                ['ID', String(user.id)],
                ['Username', user.username ? `@${user.username}` : '—'],
                ['Отображаемое имя', user.full_name || '—'],
                ['Реферальный код', user.referral_code || '—'],
                ['Регистрация', fmtDate(user.registration_date)],
                ['Статус', user.status === 'None' || !user.status ? 'Нет подписки' : user.status === 'Active' ? 'Активен' : user.status === 'Trial' ? 'Триал (активен)' : user.status === 'Expired' ? 'Истёк' : user.status],
              ].map(([l, v]) => (
                <div key={String(l)} className="inset" style={{ padding: 12 }}>
                  <div className="eyebrow mb-1">{l}</div>
                  <div className="flex items-center gap-2">
                    <span className="mono" style={{ fontSize: 13 }}>{v}</span>
                    {v && v !== '—' && <button onClick={() => copyText(String(v))} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}><Copy size={12} className="faint" /></button>}
                  </div>
                </div>
              ))}
              {/* Editable: Email */}
              <div className="inset" style={{ padding: 12 }}>
                <div className="eyebrow mb-1">Email</div>
                {editEmail !== null ? (
                  <div className="flex items-center gap-2">
                    <input className="input mono" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)}
                      placeholder="user@example.com" style={{ fontSize: 13, padding: '3px 8px', flex: 1 }}
                      onKeyDown={e => { if (e.key === 'Enter') { update('set_email', editEmail.trim() || null); setEditEmail(null!); } if (e.key === 'Escape') setEditEmail(null!); }}
                      autoFocus />
                    <button className="btn sm solid" disabled={saving === 'set_email'} onClick={() => { update('set_email', editEmail.trim() || null); setEditEmail(null!); }}>
                      {saving === 'set_email' ? <Spinner size={12} /> : <Check size={12} />}
                    </button>
                    <button className="btn sm" onClick={() => setEditEmail(null!)}><X size={12} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="mono" style={{ fontSize: 13 }}>{user.email || '—'}</span>
                    {user.email && <button onClick={() => copyText(user.email!)} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}><Copy size={12} className="faint" /></button>}
                    <button onClick={() => setEditEmail(user.email || '')} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} title="Изменить"><Edit size={12} className="faint" /></button>
                  </div>
                )}
              </div>
              {/* Editable: Telegram ID */}
              <div className="inset" style={{ padding: 12 }}>
                <div className="eyebrow mb-1">Telegram ID</div>
                {editTelegram !== null ? (
                  <div className="flex items-center gap-2">
                    <input className="input mono" type="text" value={editTelegram} onChange={e => setEditTelegram(e.target.value)}
                      placeholder="123456789" style={{ fontSize: 13, padding: '3px 8px', flex: 1 }}
                      onKeyDown={e => { if (e.key === 'Enter') { update('set_telegram', editTelegram.trim() || null); setEditTelegram(null!); } if (e.key === 'Escape') setEditTelegram(null!); }}
                      autoFocus />
                    <button className="btn sm solid" disabled={saving === 'set_telegram'} onClick={() => { update('set_telegram', editTelegram.trim() || null); setEditTelegram(null!); }}>
                      {saving === 'set_telegram' ? <Spinner size={12} /> : <Check size={12} />}
                    </button>
                    <button className="btn sm" onClick={() => setEditTelegram(null!)}><X size={12} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="mono" style={{ fontSize: 13 }}>{user.telegram_id != null ? String(user.telegram_id) : '—'}</span>
                    {user.telegram_id != null && <button onClick={() => copyText(String(user.telegram_id))} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}><Copy size={12} className="faint" /></button>}
                    <button onClick={() => setEditTelegram(user.telegram_id != null ? String(user.telegram_id) : '')} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} title="Изменить"><Edit size={12} className="faint" /></button>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Referral system */}
          <div className="card" style={{ padding: 20 }}>
            <h3 className="h-sec mb-4">Реферальная система</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Partner rate */}
              <div>
                <label className="field-label">Процент партнёра (%)</label>
                <div className="flex gap-2">
                  <input className="input mono" type="number" min="0" max="100" value={editRate} onChange={e => setEditRate(e.target.value)} style={{ maxWidth: 100 }} />
                  <button className="btn solid" disabled={saving === 'partner_rate'} onClick={() => update('partner_rate', parseInt(editRate) || 0)}>
                    {saving === 'partner_rate' ? <Spinner size={14} /> : <Save size={14} />}
                  </button>
                </div>
                <div className="sub mt-1" style={{ fontSize: 11 }}>Применяется ко всем рефералам пользователя</div>
              </div>
              {/* Partner balance */}
              <div>
                <label className="field-label">Реферальный баланс (₽)</label>
                <div className="flex gap-2">
                  <input className="input mono" type="number" min="0" step="0.01" value={editBalance} onChange={e => setEditBalance(e.target.value)} style={{ maxWidth: 120 }} />
                  <button className="btn solid" disabled={saving === 'partner_balance'} onClick={() => update('partner_balance', parseFloat(editBalance) || 0)}>
                    {saving === 'partner_balance' ? <Spinner size={14} /> : <Save size={14} />}
                  </button>
                </div>
              </div>
              {/* Referrer */}
              <div>
                <label className="field-label">Реферер</label>
                {user.referrer_telegram_id ? (
                  <div className="flex items-center gap-2">
                    <span className="mono" style={{ fontSize: 13 }}>@{user.referrer_username || user.referrer_telegram_id} (tg:{user.referrer_telegram_id})</span>
                    <button className="btn sm danger" disabled={saving === 'clear_referrer'} onClick={() => update('clear_referrer', null)}>
                      {saving === 'clear_referrer' ? <Spinner size={12} /> : <><Unlink size={12} /> Отвязать</>}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input className="input mono" type="text" placeholder="Telegram ID реферера" value={editReferrer} onChange={e => setEditReferrer(e.target.value)} />
                    <button className="btn solid" disabled={saving === 'set_referrer' || !editReferrer} onClick={() => update('set_referrer', editReferrer)}>
                      {saving === 'set_referrer' ? <Spinner size={14} /> : <Link size={14} />}
                    </button>
                  </div>
                )}
              </div>
              {/* Stats */}
              <div>
                <label className="field-label">Статистика</label>
                <div className="inset" style={{ padding: 10 }}>
                  <div className="flex justify-between" style={{ fontSize: 13 }}><span className="muted">Рефералов</span><span style={{ fontWeight: 500 }}>{user.referrals_count}</span></div>
                  <div className="flex justify-between mt-1" style={{ fontSize: 13 }}><span className="muted">Всего заработано</span><span style={{ fontWeight: 500 }}>{fmtM(user.total_earned)}</span></div>
                  <div className="flex justify-between mt-1" style={{ fontSize: 13 }}><span className="muted">Вывод заблокирован</span><span style={{ fontWeight: 500 }}>{user.referral_withdraw_blocked ? '🔒 Да' : '✅ Нет'}</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Trial reset */}
          <div className="card" style={{ padding: 20 }}>
            <h3 className="h-sec mb-2">Пробный период</h3>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="sub" style={{ fontSize: 13 }}>
                {user.trial_used ? 'Пробный период использован.' : 'Пробный период ещё не использован.'}
              </div>
              {user.trial_used ? (
                <button className="btn" disabled={saving === 'reset_trial'} onClick={() => update('reset_trial', null)}>
                  {saving === 'reset_trial' ? <Spinner size={14} /> : <><RefreshCw size={14} /> Сбросить триал</>}
                </button>
              ) : (
                <span className="badge solid" style={{ fontSize: 12 }}>Доступен</span>
              )}
            </div>
          </div>

          {/* Ban/Unban */}
          <div className="card" style={{ padding: 20 }}>
            <h3 className="h-sec mb-4">Блокировка</h3>
            {isBanned ? (
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <div className="badge danger mb-2">Заблокирован</div>
                  {user.ban_reason && <div className="sub">Причина: {user.ban_reason}</div>}
                </div>
                <button className="btn solid" disabled={saving === 'unban'} onClick={() => update('unban', null)}>
                  {saving === 'unban' ? <Spinner size={14} /> : <><CheckCircle size={14} /> Разблокировать</>}
                </button>
              </div>
            ) : (
              <button className="btn danger" onClick={() => setBanModal(true)}><Ban size={14} /> Заблокировать</button>
            )}
          </div>

          {/* Delete account */}
          <div className="card" style={{ padding: 20, border: '1px solid var(--danger, #e53e3e)' }}>
            <h3 className="h-sec mb-2" style={{ color: 'var(--danger, #e53e3e)' }}>Опасная зона</h3>
            <p className="sub mb-4" style={{ fontSize: 13 }}>Полное удаление аккаунта из базы данных. Это действие необратимо — все данные, ключи и транзакции будут удалены.</p>
            <button className="btn danger" onClick={() => setDeleteModal(true)}><Trash2 size={14} /> Удалить аккаунт полностью</button>
          </div>
        </div>
      )}

      {/* ── KEYS TAB ── */}
      {activeTab === 'keys' && (
        <div className="flex flex-col gap-4">
          {user.remnawave_keys.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}><p className="muted">Нет ключей в Remnawave</p></div>
          ) : user.remnawave_keys.map(rk => {
            const days = daysLeft(rk.expire_at);
            const usedGb = rk.traffic_used_bytes / 1024 ** 3;
            const limitGb = rk.traffic_limit_bytes ? rk.traffic_limit_bytes / 1024 ** 3 : 0;
            const usedPct = limitGb > 0 ? Math.min(100, (usedGb / limitGb) * 100) : 0;
            const devList = devicesMap[rk.uuid];
            const devLoading = loadingDevices[rk.uuid];
            return (
              <div key={rk.uuid} className="card" style={{ padding: 20 }}>
                {/* Key header */}
                <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="mono" style={{ fontSize: 13 }}>{rk.uuid}</span>
                      <button onClick={() => copyText(rk.uuid)} style={{ background: 'none', border: 0, cursor: 'pointer' }}><Copy size={12} className="faint" /></button>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`badge ${rk.status === 'ACTIVE' ? 'solid' : 'danger'}`}>{rk.status}</span>
                      {rk.sub_last_user_agent && <span className="faint" style={{ fontSize: 11 }}>{rk.sub_last_user_agent.slice(0, 50)}</span>}
                    </div>
                  </div>
                </div>

                {/* Key info grid — editable cells */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                  {/* Срок: extend/reduce via pencil */}
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="eyebrow">Истекает</div>
                      <div className="flex gap-1">
                        <button title="Продлить" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 2 }} onClick={() => { setExtendModal({ rw_uuid: rk.uuid, current_expire: rk.expire_at }); setExtendDays(''); }}><Plus size={11} className="faint" /></button>
                        <button title="Уменьшить" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 2 }} onClick={() => { setReduceModal({ rw_uuid: rk.uuid }); setReduceDays(''); }}><Clock size={11} className="faint" /></button>
                      </div>
                    </div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{rk.expire_at ? fmtDate(rk.expire_at) : '—'}</div>
                    {days !== null && <div className="sub mt-1">{days > 0 ? `${days} дней` : 'Истёк'}</div>}
                  </div>
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="eyebrow mb-1">Последнее подключение</div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{fmtDate(rk.online_at)}</div>
                  </div>
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="eyebrow mb-1">Первое подключение</div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{fmtDate(rk.first_connected_at)}</div>
                  </div>
                  {/* Трафик с карандашом */}
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="eyebrow">Трафик</div>
                      <button title="Изменить лимит" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 2 }} onClick={() => { setTrafficModal({ rw_uuid: rk.uuid, current_gb: limitGb }); setTrafficGb(String(limitGb.toFixed(0))); }}><Edit size={11} className="faint" /></button>
                    </div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{fmtGB(rk.traffic_used_bytes)} / {limitGb > 0 ? fmtGB(rk.traffic_limit_bytes) : '∞'}</div>
                    <div className="meter mt-2"><i className={usedPct > 90 ? 'crit' : usedPct > 70 ? 'warn' : ''} style={{ width: `${usedPct}%` }} /></div>
                  </div>
                  {/* Устройства с карандашом */}
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="eyebrow">HWID-устройства</div>
                      <button title="Изменить лимит" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 2 }} onClick={() => { setDevicesModal({ rw_uuid: rk.uuid, current: rk.hwid_device_limit }); setDevicesVal(String(rk.hwid_device_limit ?? '')); }}><Edit size={11} className="faint" /></button>
                    </div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{rk.hwid_device_limit ?? '∞'}</div>
                  </div>
                  {/* Сквады с карандашом */}
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="eyebrow">Сквады</div>
                      <button title="Изменить" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 2 }} onClick={() => { const cur = parseKeySquads(rk.active_internal_squads); setSquadsModal({ rw_uuid: rk.uuid, current: cur }); setSelectedSquads(cur); }}><Edit size={11} className="faint" /></button>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {parseKeySquads(rk.active_internal_squads).length === 0
                        ? <span className="muted" style={{ fontSize: 12 }}>Не назначены</span>
                        : parseKeySquads(rk.active_internal_squads).map(uuid => (
                          <span key={uuid} className="badge line" style={{ fontSize: 11 }}>{squadName(uuid)}</span>
                        ))}
                    </div>
                  </div>
                </div>

                {/* Subscription URL */}
                <div className="inset mono" style={{ padding: 10, fontSize: 11, wordBreak: 'break-all', marginBottom: 14 }}>
                  {rk.subscription_url}
                  <button onClick={() => copyText(rk.subscription_url)} style={{ background: 'none', border: 0, cursor: 'pointer', marginLeft: 8 }}><Copy size={11} className="faint" /></button>
                </div>

                {/* Block/Unblock only */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {rk.status === 'ACTIVE'
                    ? <button className="btn sm danger" onClick={() => update('rw_block', null, { rw_uuid: rk.uuid })}><Ban size={13} /> Заблокировать ключ</button>
                    : <button className="btn sm solid" onClick={() => update('rw_unblock', null, { rw_uuid: rk.uuid })}><CheckCircle size={13} /> Разблокировать ключ</button>
                  }
                </div>

                {/* HWID Devices */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="h-sec" style={{ fontSize: 13 }}>HWID-устройства</h4>
                    {!devList && <button className="btn sm" onClick={() => loadDevices(rk.uuid, user.id)} disabled={devLoading}>{devLoading ? <Spinner size={12} /> : 'Загрузить'}</button>}
                    {devList && <button className="btn ghost sm" onClick={() => { setDevicesMap(prev => { const n = { ...prev }; delete n[rk.uuid]; return n; }); }}>Обновить</button>}
                  </div>
                  {devLoading && <div className="flex items-center gap-2 muted" style={{ fontSize: 13 }}><Spinner size={14} /> Загрузка...</div>}
                  {devList === 'unsupported' as any && <p className="muted" style={{ fontSize: 13 }}>⚠️ Ваша версия Remnawave не поддерживает просмотр HWID-устройств</p>}
                  {Array.isArray(devList) && devList.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Нет привязанных устройств</p>}
                  {Array.isArray(devList) && devList.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {devList.map((dev, idx) => {
                        const devId = dev.hwid || dev.id || dev.uuid || String(idx);
                        return (
                          <div key={devId} className="inset" style={{ padding: 12 }}>
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div style={{ fontWeight: 500, fontSize: 13 }}>{dev.deviceModel || dev.platform || 'Неизвестное устройство'}{dev.osVersion ? ` (${dev.osVersion})` : ''}</div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                                  {dev.requestIp && <span className="faint mono" style={{ fontSize: 11 }}>IP: {dev.requestIp}</span>}
                                  {dev.userAgent && <span className="faint" style={{ fontSize: 11 }}>{dev.userAgent.slice(0, 60)}</span>}
                                  {dev.createdAt && <span className="faint" style={{ fontSize: 11 }}>Добавлено: {fmtDate(dev.createdAt)}</span>}
                                  {dev.updatedAt && <span className="faint" style={{ fontSize: 11 }}>Обновлено: {fmtDate(dev.updatedAt)}</span>}
                                  {dev.hwid && <span className="faint mono" style={{ fontSize: 11 }}>HWID: {dev.hwid}</span>}
                                </div>
                              </div>
                              <button className="btn sm danger" onClick={() => deleteDevice(rk.uuid, devId, user.id)}><Trash2 size={12} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── PAYMENTS TAB ── */}
      {activeTab === 'payments' && (
        <div className="flex flex-col gap-4">
          <div className="card" style={{ padding: 20 }}>
            <h3 className="h-sec mb-3">Привязанные карты</h3>
            {(user.payment_methods || []).length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Нет сохранённых карт</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(user.payment_methods || []).map(pm => (
                  <div key={pm.id} className="inset flex items-center justify-between gap-3" style={{ padding: 12 }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{pm.card_brand || 'Карта'} •••• {pm.card_last4 || '????'}</div>
                      <div className="faint" style={{ fontSize: 11 }}>{pm.payment_provider} · id {pm.id}</div>
                    </div>
                    <button
                      className="btn sm danger"
                      disabled={saving === `unlink_card_${pm.id}`}
                      onClick={async () => {
                        if (!confirm('Отвязать карту и отменить автосписания?')) return;
                        setSaving(`unlink_card_${pm.id}`);
                        try {
                          await apiFetch(`/panel/users/${user.id}/payment-methods/${pm.id}`, { method: 'DELETE' });
                          onToast('Карта отвязана');
                          await reload();
                        } catch (e: any) {
                          onToast('Ошибка', e.message, 'error');
                        }
                        setSaving(null);
                      }}
                    >
                      {saving === `unlink_card_${pm.id}` ? <Spinner size={12} /> : <><Unlink size={12} /> Отвязать</>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>ID</th><th>Тип</th><th>Сумма</th><th>Статус</th><th>Метод</th><th>Описание</th><th>Дата</th><th></th></tr></thead>
              <tbody>
                {user.transactions.length === 0
                  ? <tr className="empty-row"><td colSpan={8}>Нет операций</td></tr>
                  : user.transactions.map(tx => (
                    <tr key={tx.id}>
                      <td className="muted mono">#{tx.id}</td>
                      <td className="faint" style={{ fontSize: 12 }}>{tx.type === "trial" ? "Пробная" : tx.type === "subscription" ? "Покупка" : tx.type === "subscription_extend" ? "Продление" : tx.type === "refund" ? "Возврат" : tx.type === "deposit" ? "Пополнение" : tx.type || "—"}</td>
                      <td style={{ fontWeight: 600 }}>{Math.abs(tx.amount).toLocaleString('ru-RU')} ₽</td>
                      <td><span className={`badge ${tx.status === 'Success' ? 'solid' : tx.status === 'Pending' ? 'mute' : 'danger'}`}>{tx.status === 'Success' ? 'Успешно' : tx.status === 'Refunded' ? 'Возвращён' : tx.status === 'Pending' ? 'Обработка' : tx.status}</span></td>
                      <td className="muted">{tx.payment_provider || tx.payment_method || '—'}</td>
                      <td className="faint" style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.description || '—'}</td>
                      <td className="faint">{fmtDateShort(tx.created_at)}</td>
                      <td>
                        {['subscription', 'subscription_extend'].includes(tx.type) && tx.status === 'Success' && tx.amount > 0 && (
                          <button
                            className="btn sm danger"
                            disabled={saving === `refund_${tx.id}`}
                            onClick={async () => {
                              if (!confirm(`Вернуть ${tx.amount}₽ через Т‑Банк?`)) return;
                              setSaving(`refund_${tx.id}`);
                              try {
                                const d = await apiFetch(`/panel/transactions/${tx.id}/refund`, { method: 'POST' });
                                onToast(d?.message || 'Возврат выполнен');
                                await reload();
                              } catch (e: any) {
                                onToast('Ошибка возврата', e.message, 'error');
                              }
                              setSaving(null);
                            }}
                          >
                            {saving === `refund_${tx.id}` ? <Spinner size={12} /> : 'Возврат'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── REFERRALS TAB ── */}
      {activeTab === 'referrals' && (
        <ReferralsList userId={user.id} onToast={onToast} />
      )}

      {/* ── MODALS ── */}
      {deleteModal && (
        <Modal onClose={() => setDeleteModal(false)} title="Удалить аккаунт" icon={Trash2} width={420}
          footer={<>
            <button className="btn block" onClick={() => setDeleteModal(false)}>Отмена</button>
            <button className="btn block danger" disabled={saving === 'delete_account'} onClick={async () => {
              setSaving('delete_account');
              try {
                await apiFetch(`/panel/users/${user.id}/delete`, { method: 'DELETE' });
                onToast('Аккаунт удалён', undefined, 'success');
                setDeleteModal(false);
                onBack();
              } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
              setSaving('');
            }}>
              {saving === 'delete_account' ? <Spinner size={14} /> : 'Удалить безвозвратно'}
            </button>
          </>}
        >
          <p style={{ fontSize: 14 }}>Вы уверены, что хотите <b>полностью удалить</b> аккаунт пользователя <b>@{user.username || user.id}</b>?</p>
          <p className="sub mt-2" style={{ fontSize: 13 }}>Будут удалены: все VPN-ключи (включая в Remnawave), транзакции, сессии, реферальные данные.</p>
        </Modal>
      )}
      {banModal && (
        <Modal onClose={() => setBanModal(false)} title="Заблокировать пользователя" icon={Ban} width={400}
          footer={<>
            <button className="btn block" onClick={() => setBanModal(false)}>Отмена</button>
            <button className="btn block danger" disabled={saving === 'ban'} onClick={async () => { await update('ban', banReason, { notify: true }); setBanModal(false); }}>
              {saving === 'ban' ? <Spinner size={14} /> : 'Заблокировать'}
            </button>
          </>}>
          <label className="field-label">Причина блокировки</label>
          <input className="input" value={banReason} onChange={e => setBanReason(e.target.value)} placeholder="Нарушение правил..." />
        </Modal>
      )}

      {extendModal && (
        <Modal onClose={() => setExtendModal(null)} title="Продлить подписку" icon={Plus} width={380}
          footer={<>
            <button className="btn block" onClick={() => setExtendModal(null)}>Отмена</button>
            <button className="btn block solid" disabled={saving === 'rw_extend'} onClick={async () => { await update('rw_extend', parseInt(extendDays) || 0, { rw_uuid: extendModal.rw_uuid, notify: true }); setExtendModal(null); }}>
              {saving === 'rw_extend' ? <Spinner size={14} /> : 'Продлить'}
            </button>
          </>}>
          <label className="field-label">Дней</label>
          <div className="stepper">
            <button className="step" onClick={() => setExtendDays(String(Math.max(0, parseInt(extendDays || '0') - 1)))}>−</button>
            <input className="input center mono" type="number" value={extendDays} onChange={e => setExtendDays(e.target.value)} autoFocus />
            <button className="step" onClick={() => setExtendDays(String(parseInt(extendDays || '0') + 1))}>+</button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {[1, 3, 7, 14, 30, 90, 365].map(d => (
              <button key={d} className={`chip ${extendDays === String(d) ? 'on' : ''}`} onClick={() => setExtendDays(String(d))}>{d}д</button>
            ))}
          </div>
        </Modal>
      )}

      {reduceModal && (
        <Modal onClose={() => setReduceModal(null)} title="Уменьшить срок" icon={Clock} width={380}
          footer={<>
            <button className="btn block" onClick={() => setReduceModal(null)}>Отмена</button>
            <button className="btn block danger" disabled={saving === 'rw_reduce'} onClick={async () => { await update('rw_reduce', parseInt(reduceDays) || 0, { rw_uuid: reduceModal.rw_uuid, notify: true }); setReduceModal(null); }}>
              {saving === 'rw_reduce' ? <Spinner size={14} /> : 'Уменьшить'}
            </button>
          </>}>
          <label className="field-label">Дней</label>
          <div className="stepper">
            <button className="step" onClick={() => setReduceDays(String(Math.max(0, parseInt(reduceDays || '0') - 1)))}>−</button>
            <input className="input center mono" type="number" value={reduceDays} onChange={e => setReduceDays(e.target.value)} autoFocus />
            <button className="step" onClick={() => setReduceDays(String(parseInt(reduceDays || '0') + 1))}>+</button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">{[1, 3, 7, 14, 30].map(d => (<button key={d} className={`chip ${reduceDays === String(d) ? 'on' : ''}`} onClick={() => setReduceDays(String(d))}>{d}д</button>))}</div>
        </Modal>
      )}

      {trafficModal && (
        <Modal onClose={() => setTrafficModal(null)} title="Установить лимит трафика" icon={Database} width={380}
          footer={<>
            <button className="btn block" onClick={() => setTrafficModal(null)}>Отмена</button>
            <button className="btn block solid" disabled={saving === 'rw_set_traffic'} onClick={async () => { await update('rw_set_traffic', parseFloat(trafficGb) || 0, { rw_uuid: trafficModal.rw_uuid, notify: true }); setTrafficModal(null); }}>
              {saving === 'rw_set_traffic' ? <Spinner size={14} /> : 'Применить'}
            </button>
          </>}>
          <label className="field-label">Гигабайт (0 = безлимит)</label>
          <input className="input mono" type="number" min="0" step="1" value={trafficGb} onChange={e => setTrafficGb(e.target.value)} autoFocus />
          <div className="flex flex-wrap gap-2 mt-3">{[10, 25, 50, 100, 200, 500].map(g => (<button key={g} className={`chip ${trafficGb === String(g) ? 'on' : ''}`} onClick={() => setTrafficGb(String(g))}>{g} ГБ</button>))}</div>
        </Modal>
      )}

      {devicesModal && (
        <Modal onClose={() => setDevicesModal(null)} title="Лимит HWID-устройств" icon={Smartphone} width={380}
          footer={<>
            <button className="btn block" onClick={() => setDevicesModal(null)}>Отмена</button>
            <button className="btn block solid" disabled={saving === 'rw_set_devices'} onClick={async () => { await update('rw_set_devices', parseInt(devicesVal) || 1, { rw_uuid: devicesModal.rw_uuid, notify: true }); setDevicesModal(null); }}>
              {saving === 'rw_set_devices' ? <Spinner size={14} /> : 'Применить'}
            </button>
          </>}>
          <label className="field-label">Количество устройств</label>
          <div className="stepper">
            <button className="step" onClick={() => setDevicesVal(String(Math.max(1, parseInt(devicesVal || '1') - 1)))}>−</button>
            <input className="input center mono" type="number" min="1" value={devicesVal} onChange={e => setDevicesVal(e.target.value)} autoFocus />
            <button className="step" onClick={() => setDevicesVal(String(parseInt(devicesVal || '1') + 1))}>+</button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">{[1, 2, 3, 5, 10, 20].map(n => (<button key={n} className={`chip ${devicesVal === String(n) ? 'on' : ''}`} onClick={() => setDevicesVal(String(n))}>{n}</button>))}</div>
        </Modal>
      )}

      {squadsModal && (
        <Modal onClose={() => setSquadsModal(null)} title="Сквады Remnawave" icon={Layers} width={460}
          footer={<>
            <button className="btn block" onClick={() => setSquadsModal(null)}>Отмена</button>
            <button className="btn block solid" disabled={saving === 'rw_set_squads' || selectedSquads.length === 0} onClick={async () => {
              await update('rw_set_squads', selectedSquads, { rw_uuid: squadsModal.rw_uuid, notify: true });
              setSquadsModal(null);
            }}>
              {saving === 'rw_set_squads' ? <Spinner size={14} /> : 'Применить'}
            </button>
          </>}>
          {rwSquads.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Список сквадов пуст. Синхронизируйте их в разделе «Сквады».</p>
          ) : (
            <>
              <label className="field-label">Выберите сквады для ключа</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {rwSquads.map(sq => {
                  const on = selectedSquads.includes(sq.uuid);
                  return (
                    <button
                      key={sq.uuid}
                      type="button"
                      className={`chip ${on ? 'on' : ''}`}
                      onClick={() => setSelectedSquads(prev => on ? prev.filter(u => u !== sq.uuid) : [...prev, sq.uuid])}
                    >
                      {sq.name}
                    </button>
                  );
                })}
              </div>
              <div className="sub mt-3" style={{ fontSize: 11 }}>Можно выбрать несколько сквадов</div>
            </>
          )}
        </Modal>
      )}

      {notifModal && (
        <Modal onClose={() => setNotifModal(false)} title="Отправить уведомление" icon={Bell} width={420}
          footer={<>
            <button className="btn block" onClick={() => setNotifModal(false)}>Отмена</button>
            <button className="btn block solid" disabled={!notifMsg.trim()} onClick={sendNotif}><Send size={14} /> Отправить</button>
          </>}>
          <label className="field-label">Сообщение</label>
          <textarea className="textarea" rows={4} value={notifMsg} onChange={e => setNotifMsg(e.target.value)} placeholder="Текст сообщения..." autoFocus />
        </Modal>
      )}
    </div>
  );
};

// ─── REFERRALS LIST ───────────────────────────────────────────────
const ReferralsList: React.FC<{ userId: number; onToast: (t: string, m?: string, ty?: ToastType) => void }> = ({ userId, onToast }) => {
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/panel/users/${userId}/referrals-list`)
      .then(d => { setReferrals(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(e => { onToast('Ошибка', e.message, 'error'); setLoading(false); });
  }, [userId]);

  if (loading) return <div className="flex items-center justify-center" style={{ height: 100 }}><Spinner /></div>;

  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Telegram ID</th><th>Username</th><th>Статус</th><th>Активных ключей</th><th>Баланс</th><th>Дата регистрации</th></tr></thead>
        <tbody>
          {referrals.length === 0
            ? <tr className="empty-row"><td colSpan={6}>Нет рефералов</td></tr>
            : referrals.map(r => (
              <tr key={r.id}>
                <td className="mono muted">{r.telegram_id}</td>
                <td>{r.username ? `@${r.username}` : r.full_name || '—'}</td>
                <td><span className={`badge ${r.is_banned ? 'danger' : r.status === 'Active' ? 'solid' : 'mute'}`}>{r.is_banned ? 'Заблокирован' : r.status}</span></td>
                <td className="muted">{r.active_keys}</td>
                <td className="mono">{fmtM(r.partner_balance)}</td>
                <td className="faint">{fmtDateShort(r.registration_date)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── USERS PAGE ───────────────────────────────────────────────────
const UsersPage: React.FC<{ onOpenUser: (userId: number) => void }> = ({ onOpenUser }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'None' | 'Trial' | 'Active' | 'Expired' | 'Banned'>('all');
  const [users, setUsers] = useState<PanelUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const PAGE_SIZE = 50;

  useEffect(() => { setPage(0); }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const qp = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
        if (debouncedSearch) { qp.set('search', debouncedSearch); qp.set('q', debouncedSearch); }
        const d = await apiFetch(`/panel/users?${qp}`);
        if (cancelled) return;
        const raw: any[] = Array.isArray(d) ? d : (d?.users || []);
        const mapped: PanelUser[] = raw.map((u: any) => ({
          id: u.id, telegram_id: u.telegram_id, email: u.email || null,
          username: u.username, full_name: u.full_name,
          balance: u.balance ?? 0, status: u.status || 'New',
          registration_date: u.registration_date,
          is_banned: u.is_banned || 0, in_blacklist: !!u.in_blacklist,
          partner_balance: u.partner_balance ?? 0, partner_rate: u.partner_rate ?? 30,
          expiry_date: u.expiry_date || null,
          traffic_used: u.traffic_used ?? null,
          traffic_limit: u.traffic_limit ?? null,
        }));
        const filtered = statusFilter === 'all' ? mapped : mapped.filter(u =>
          statusFilter === 'Banned' ? (u.is_banned || u.in_blacklist) : u.status === statusFilter
        );
        setUsers(filtered);
        setTotal(d?.total ?? filtered.length);
      } catch (e) { console.error(e); }
      if (!cancelled) setLoading(false);
    }, 50);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [debouncedSearch, statusFilter, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterLabels: Record<string, string> = { all: 'Все', None: 'Без подписки', Trial: 'Триал', Active: 'Активные', Expired: 'Истёкшие', Banned: 'Забл.' };

  return (
    <div className="flex flex-col gap-6 rise">
      <div><div className="h-page">Пользователи</div><div className="sub mt-1">База клиентов</div></div>
      <div className="flex gap-3">
        <div className="search flex-1">
          <Search className="ico" size={16} />
          <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Имя, email, username или ID…" />
        </div>
        <div style={{ position: 'relative' }}>
          <button className={`btn ${statusFilter !== 'all' ? 'solid' : ''}`} onClick={() => setShowFilter(!showFilter)}>
            <Filter size={15} /> {filterLabels[statusFilter]}
          </button>
          {showFilter && (
            <div className="menu" style={{ right: 0 }}>
              {(['all', 'None', 'Trial', 'Active', 'Expired', 'Banned'] as const).map(f => (
                <button key={f} className="menu-item" onClick={() => { setStatusFilter(f); setShowFilter(false); }}>{filterLabels[f]}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Пользователь</th><th>Статус</th><th>Ключ / Трафик</th><th>Реф. баланс</th><th>Регистрация</th></tr></thead>
          <tbody>
            {loading ? (
              <tr className="empty-row"><td colSpan={5}><Spinner /></td></tr>
            ) : users.length === 0 ? (
              <tr className="empty-row"><td colSpan={5}>Пользователи не найдены</td></tr>
            ) : users.map(u => {
              const isBanned = u.is_banned === 1 || u.in_blacklist;
              const badge = isBanned ? { cls: 'danger', label: 'Заблокирован' }
                : u.status === 'Active' ? { cls: 'solid', label: 'Активен' }
                : u.status === 'Trial' ? { cls: 'mute', label: 'Триал' }
                : u.status === 'None' || !u.status ? { cls: 'line', label: 'Нет подписки' }
                : { cls: 'line', label: 'Истёк' };
              return (
                <tr key={u.id} className="click" onClick={() => onOpenUser(u.id)}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{u.username ? `@${u.username}` : u.full_name || u.email || (u.telegram_id != null ? `id${u.telegram_id}` : `#${u.id}`)}</div>
                    <div className="faint mono" style={{ fontSize: 11 }}>{u.email || (u.telegram_id != null ? `tg:${u.telegram_id}` : `id:${u.id}`)}</div>
                  </td>
                  <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                  <td>
                    {u.expiry_date ? (
                      <div style={{ fontSize: 12 }}>
                        <div className="mono faint" style={{ fontSize: 11 }}>до {fmtDateShort(u.expiry_date)}</div>
                        {u.traffic_limit != null && u.traffic_limit > 0 && (
                          <div className="faint" style={{ fontSize: 11 }}>{fmtGB(u.traffic_used ?? 0)} / {fmtGB(u.traffic_limit)}</div>
                        )}
                      </div>
                    ) : <span className="faint" style={{ fontSize: 12 }}>—</span>}
                  </td>
                  <td className="mono">{fmtM(u.partner_balance)}</td>
                  <td className="faint">{fmtDateShort(u.registration_date)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="sub">Всего: <span style={{ fontWeight: 600, color: 'var(--text)' }}>{total.toLocaleString('ru-RU')}</span></div>
        <div className="flex items-center gap-2">
          <button className="btn sm" disabled={page <= 0 || loading} onClick={() => setPage(p => p - 1)}>Назад</button>
          <span className="sub" style={{ minWidth: 60, textAlign: 'center' }}>{page + 1} / {totalPages}</span>
          <button className="btn sm" disabled={page >= totalPages - 1 || loading} onClick={() => setPage(p => p + 1)}>Вперёд</button>
        </div>
      </div>
    </div>
  );
};

// ─── KEYS PAGE ────────────────────────────────────────────────────
const KeysPage: React.FC<{ onToast: (t: string, m?: string, ty?: ToastType) => void }> = ({ onToast }) => {
  const [search, setSearch] = useState('');
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch('/panel/keys?limit=200').then(d => {
      if (!cancelled) {
        const raw = Array.isArray(d) ? d : (d?.keys || []);
        setKeys(raw);
        setLoading(false);
      }
    }).catch(e => { if (!cancelled) { console.error(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const filtered = keys.filter(k => {
    const sm = !search || (k.key_uuid || '').toLowerCase().includes(search.toLowerCase()) || (k.username || '').toLowerCase().includes(search.toLowerCase());
    const fm = statusFilter === 'all' || k.status === statusFilter;
    return sm && fm;
  });

  return (
    <div className="flex flex-col gap-6 rise">
      <div><div className="h-page">Ключи</div><div className="sub mt-1">Управление подписками</div></div>
      <div className="grid grid-cols-3 gap-4">
        <Stat title="Всего" value={keys.length} icon={Key} />
        <Stat title="Истекших" value={keys.filter(k => k.status === 'Expired').length} icon={Clock} />
        <Stat title="Заблокировано" value={keys.filter(k => k.status === 'Banned').length} icon={Ban} />
      </div>
      <div className="flex gap-3">
        <div className="search flex-1"><Search className="ico" size={16} /><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="UUID или пользователь…" /></div>
        <div style={{ position: 'relative' }}>
          <button className={`btn ${statusFilter !== 'all' ? 'solid' : ''}`} onClick={() => setShowFilter(!showFilter)}><Filter size={15} /> {statusFilter === 'all' ? 'Все' : statusFilter}</button>
          {showFilter && (
            <div className="menu" style={{ right: 0 }}>
              {['all', 'Active', 'Expired', 'Banned'].map(f => (
                <button key={f} className="menu-item" onClick={() => { setStatusFilter(f); setShowFilter(false); }}>{f === 'all' ? 'Все' : f}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>UUID</th><th>Пользователь</th><th>Статус</th><th>Трафик</th><th>Истекает</th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={5}><Spinner /></td></tr>
              : filtered.length === 0 ? <tr className="empty-row"><td colSpan={5}>Ключи не найдены</td></tr>
              : filtered.map(k => {
                const badge = k.status === 'Active' ? { cls: 'solid', label: 'Активен' } : k.status === 'Banned' ? { cls: 'danger', label: 'Забл.' } : { cls: 'line', label: 'Истёк' };
                const usedPct = k.traffic_limit > 0 ? Math.min(100, (k.traffic_used / k.traffic_limit) * 100) : 0;
                return (
                  <tr key={k.id}>
                    <td className="mono faint" style={{ fontSize: 11 }}>{(k.key_uuid || '').slice(0, 18)}…</td>
                    <td className="muted">{k.username || k.telegram_id || '—'}</td>
                    <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                    <td>
                      <div className="meter" style={{ width: 60 }}><i className={usedPct > 90 ? 'crit' : usedPct > 70 ? 'warn' : ''} style={{ width: `${usedPct}%` }} /></div>
                      <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>{fmtGB(k.traffic_used)} / {k.traffic_limit > 0 ? fmtGB(k.traffic_limit) : '∞'}</div>
                    </td>
                    <td className="muted">{fmtDateShort(k.expiry_date)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── MAILING PAGE ─────────────────────────────────────────────────
const MailingPage: React.FC<{ onToast: (t: string, m?: string, ty?: ToastType) => void }> = ({ onToast }) => {
  const [text, setText] = useState('');
  const [target, setTarget] = useState('all');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await apiFetch('/panel/mailing', { method: 'POST', body: JSON.stringify({ message_text: text, target_users: target, title: 'Рассылка' }) });
      onToast('Рассылка запущена', undefined, 'success');
      setText('');
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
    setSending(false);
  };

  return (
    <div className="flex flex-col gap-6 rise">
      <div><div className="h-page">Рассылка</div><div className="sub mt-1">Массовые уведомления</div></div>
      <div className="card" style={{ padding: 24 }}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="field-label">Аудитория</label>
            <select className="select" value={target} onChange={e => setTarget(e.target.value)}>
              <option value="all">Все пользователи</option>
              <option value="active">Активные подписчики</option>
              <option value="trial">Пробный период</option>
              <option value="expired">Истекшие</option>
            </select>
          </div>
          <div>
            <label className="field-label">Сообщение (HTML поддерживается)</label>
            <textarea className="textarea" rows={6} value={text} onChange={e => setText(e.target.value)} placeholder="Текст рассылки..." />
          </div>
          <button className="btn solid" style={{ width: 'fit-content' }} disabled={sending || !text.trim()} onClick={send}>
            {sending ? <Spinner size={14} /> : <><Send size={14} /> Отправить</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── PROMOCODES PAGE ──────────────────────────────────────────────
const PromocodesPage: React.FC<{ onToast: (t: string, m?: string, ty?: ToastType) => void }> = ({ onToast }) => {
  const [promos, setPromos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', type: 'balance', value: '', uses_limit: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await apiFetch('/panel/promocodes'); setPromos(Array.isArray(d) ? d : []); }
    catch (e: any) { onToast('Ошибка', e.message, 'error'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      await apiFetch('/panel/promocodes', { method: 'POST', body: JSON.stringify({ ...form, uses_limit: parseInt(form.uses_limit) || null }) });
      onToast('Промокод создан', undefined, 'success');
      setShowCreate(false); setForm({ code: '', type: 'balance', value: '', uses_limit: '' });
      await load();
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
  };

  const del = async (id: number) => {
    try {
      await apiFetch(`/panel/promocodes/${id}`, { method: 'DELETE' });
      setPromos(prev => prev.filter(p => p.id !== id));
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
  };

  const typeLabel = (t: string) => ({ balance: 'Баланс', discount: 'Скидка', ref_boost: 'Реф. буст', subscription: 'Подписка' }[t] || t);

  return (
    <div className="flex flex-col gap-6 rise">
      <div className="flex items-center justify-between">
        <div><div className="h-page">Промокоды</div><div className="sub mt-1">Управление кодами</div></div>
        <button className="btn solid" onClick={() => setShowCreate(true)}><Plus size={15} /> Создать</button>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Код</th><th>Тип</th><th>Значение</th><th>Использований</th><th>Лимит</th><th>Активен</th><th></th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={7}><Spinner /></td></tr>
              : promos.length === 0 ? <tr className="empty-row"><td colSpan={7}>Нет промокодов</td></tr>
              : promos.map(p => (
                <tr key={p.id}>
                  <td className="mono">{p.code}</td>
                  <td className="muted">{typeLabel(p.type)}</td>
                  <td className="mono">{p.value}</td>
                  <td className="muted">{p.uses_count || 0}</td>
                  <td className="muted">{p.uses_limit ?? '∞'}</td>
                  <td><span className={`badge ${p.is_active ? 'solid' : 'line'}`}>{p.is_active ? 'Да' : 'Нет'}</span></td>
                  <td><button className="btn sm danger" onClick={() => del(p.id)}><Trash2 size={13} /></button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="Создать промокод" icon={Gift} width={420}
          footer={<>
            <button className="btn block" onClick={() => setShowCreate(false)}>Отмена</button>
            <button className="btn block solid" onClick={create}>Создать</button>
          </>}>
          <div className="flex flex-col gap-4">
            <div><label className="field-label">Код</label><input className="input mono" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="PROMO2025" /></div>
            <div><label className="field-label">Тип</label>
              <select className="select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="balance">Баланс</option><option value="discount">Скидка %</option><option value="subscription">Подписка (дни)</option>
              </select>
            </div>
            <div><label className="field-label">Значение</label><input className="input mono" type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} /></div>
            <div><label className="field-label">Лимит использований (0 = ∞)</label><input className="input mono" type="number" value={form.uses_limit} onChange={e => setForm(f => ({ ...f, uses_limit: e.target.value }))} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ─── SQUADS PAGE ──────────────────────────────────────────────────
interface SquadConfig {
  squad_uuid: string;
  squad_name: string;
  squad_type: string;
  max_users: number;
  current_users: number;
  is_active: number;
  priority: number;
}

const SquadsPage: React.FC<{ onToast: (t: string, m?: string, ty?: ToastType) => void }> = ({ onToast }) => {
  const [squads, setSquads] = useState<SquadConfig[]>([]);
  const [rwSquads, setRwSquads] = useState<{ uuid: string; name: string; members_count?: number }[]>([]);
  const [defaultSquads, setDefaultSquads] = useState<string[]>([]);
  const [mapping, setMapping] = useState<{ vpn: string[]; trial: string[] }>({ vpn: [], trial: [] });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sqData, defData, rwData] = await Promise.all([
        apiFetch('/panel/squads'),
        apiFetch('/panel/default-squads'),
        apiFetch('/panel/remnawave/squads').catch(() => []),
      ]);
      setSquads(sqData?.squads || []);
      setMapping({ vpn: sqData?.mapping?.vpn || [], trial: sqData?.mapping?.trial || [] });
      setDefaultSquads(defData?.vpn_squads || []);
      setRwSquads(Array.isArray(rwData) ? rwData : []);
    } catch (e: any) {
      onToast('Ошибка загрузки', e.message, 'error');
    }
    setLoading(false);
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const squadOptions = rwSquads.length > 0
    ? rwSquads
    : squads.map(s => ({ uuid: s.squad_uuid, name: s.squad_name, members_count: s.current_users }));

  const syncFromRemnawave = async () => {
    setSyncing(true);
    try {
      const d = await apiFetch('/panel/squads/sync', { method: 'POST' });
      onToast('Синхронизация завершена', `${d?.count ?? 0} сквадов`, 'success');
      await load();
    } catch (e: any) {
      onToast('Ошибка синхронизации', e.message, 'error');
    }
    setSyncing(false);
  };

  const saveDefaults = async () => {
    setSavingDefaults(true);
    try {
      await apiFetch('/panel/default-squads', { method: 'PUT', body: JSON.stringify({ vpn_squads: defaultSquads }) });
      onToast('Сквады по умолчанию сохранены', undefined, 'success');
    } catch (e: any) {
      onToast('Ошибка', e.message, 'error');
    }
    setSavingDefaults(false);
  };

  const saveMapping = async () => {
    setSavingMapping(true);
    try {
      await apiFetch('/panel/squads/mapping', { method: 'PUT', body: JSON.stringify(mapping) });
      onToast('Маппинг подписок сохранён', undefined, 'success');
    } catch (e: any) {
      onToast('Ошибка', e.message, 'error');
    }
    setSavingMapping(false);
  };

  const toggleChip = (list: string[], uuid: string, setter: (v: string[]) => void) => {
    setter(list.includes(uuid) ? list.filter(u => u !== uuid) : [...list, uuid]);
  };

  const ChipPicker: React.FC<{ label: string; selected: string[]; onChange: (v: string[]) => void }> = ({ label, selected, onChange }) => (
    <div>
      <label className="field-label">{label}</label>
      {squadOptions.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Нет сквадов — нажмите «Синхронизировать»</p>
      ) : (
        <div className="flex flex-wrap gap-2 mt-2">
          {squadOptions.map(sq => (
            <button
              key={sq.uuid}
              type="button"
              className={`chip ${selected.includes(sq.uuid) ? 'on' : ''}`}
              onClick={() => toggleChip(selected, sq.uuid, onChange)}
            >
              {sq.name}
              {sq.members_count != null && <span className="faint" style={{ fontSize: 11 }}>({sq.members_count})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center" style={{ height: 200 }}><Spinner size={28} /></div>
  );

  return (
    <div className="flex flex-col gap-6 rise">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="h-page">Сквады Remnawave</div>
          <div className="sub mt-1">Выбор сквадов для новых подписок и балансировка</div>
        </div>
        <button className="btn solid" disabled={syncing} onClick={syncFromRemnawave}>
          {syncing ? <Spinner size={14} /> : <><RefreshCw size={14} /> Синхронизировать</>}
        </button>
      </div>

      <div className="card" style={{ padding: 24 }}>
        <h3 className="h-sec mb-4">Сквады по умолчанию (VPN)</h3>
        <ChipPicker label="Используются, если балансировщик не выбрал сквад" selected={defaultSquads} onChange={setDefaultSquads} />
        <button className="btn solid mt-4" disabled={savingDefaults || defaultSquads.length === 0} onClick={saveDefaults}>
          {savingDefaults ? <Spinner size={14} /> : <><Save size={14} /> Сохранить</>}
        </button>
      </div>

      <div className="card" style={{ padding: 24 }}>
        <h3 className="h-sec mb-4">Маппинг подписок → сквады</h3>
        <div className="flex flex-col gap-5">
          <ChipPicker label="VPN / платные подписки" selected={mapping.vpn} onChange={v => setMapping(m => ({ ...m, vpn: v }))} />
          <ChipPicker label="Trial / пробные" selected={mapping.trial} onChange={v => setMapping(m => ({ ...m, trial: v }))} />
        </div>
        <button className="btn solid mt-4" disabled={savingMapping} onClick={saveMapping}>
          {savingMapping ? <Spinner size={14} /> : <><Save size={14} /> Сохранить маппинг</>}
        </button>
      </div>

      <div className="tbl-wrap">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 className="h-sec">Настроенные сквады ({squads.length})</h3>
        </div>
        <table className="tbl">
          <thead><tr><th>Название</th><th>Тип</th><th>Пользователей</th><th>Лимит</th><th>Приоритет</th><th>Статус</th></tr></thead>
          <tbody>
            {squads.length === 0
              ? <tr className="empty-row"><td colSpan={6}>Нет сквадов — синхронизируйте из Remnawave</td></tr>
              : squads.map(s => (
                <tr key={s.squad_uuid}>
                  <td style={{ fontWeight: 500 }}>{s.squad_name}</td>
                  <td><span className="badge line">{s.squad_type}</span></td>
                  <td className="mono muted">{s.current_users}</td>
                  <td className="muted">{s.max_users > 0 ? s.max_users : '∞'}</td>
                  <td className="muted">{s.priority}</td>
                  <td><span className={`badge ${s.is_active ? 'solid' : 'line'}`}>{s.is_active ? 'Активен' : 'Выкл'}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── SETTINGS PAGE ────────────────────────────────────────────────
const ROLE_TABS: { key: string; label: string }[] = [
  { key: 'dashboard', label: 'Главная' },
  { key: 'finance', label: 'Финансы' },
  { key: 'stats', label: 'Статистика' },
  { key: 'users', label: 'Пользователи' },
  { key: 'mailing', label: 'Рассылка' },
  { key: 'promocodes', label: 'Промокоды' },
  { key: 'squads', label: 'Сквады' },
  { key: 'settings', label: 'Настройки' },
  { key: 'roles', label: 'Роли' },
];

const PAGE_TO_PERM: Record<string, string> = {
  'Главная': 'dashboard',
  'Финансы': 'finance',
  'Статистика': 'stats',
  'Пользователи': 'users',
  'Рассылка': 'mailing',
  'Промокоды': 'promocodes',
  'Сквады': 'squads',
  'Настройки': 'settings',
  'Роли': 'roles',
};

const emptyPerms = (): Record<string, string> =>
  Object.fromEntries(ROLE_TABS.map(t => [t.key, 'none']));

const PermissionsMatrix: React.FC<{
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => (
  <div className="tbl-wrap">
    <table className="tbl">
      <thead>
        <tr>
          <th>Раздел</th>
          <th>Нет</th>
          <th>Просмотр</th>
          <th>Редактирование</th>
        </tr>
      </thead>
      <tbody>
        {ROLE_TABS.map(tab => {
          const cur = value[tab.key] || 'none';
          return (
            <tr key={tab.key}>
              <td style={{ fontWeight: 500 }}>{tab.label}</td>
              {(['none', 'view', 'edit'] as const).map(level => (
                <td key={level}>
                  <input
                    type="radio"
                    name={`perm-${tab.key}`}
                    checked={cur === level}
                    disabled={disabled}
                    onChange={() => onChange({ ...value, [tab.key]: level })}
                  />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const RolesPage: React.FC<{
  onToast: (t: string, m?: string, ty?: ToastType) => void;
  currentUsername?: string;
  canEdit: boolean;
}> = ({ onToast, currentUsername, canEdit }) => {
  const [loading, setLoading] = useState(true);
  const [admins, setAdmins] = useState<any[]>([]);
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    username: '',
    password: '',
    telegram_id: '',
    is_superadmin: false,
    is_active: true,
    permissions: emptyPerms(),
  });
  const [pwdModal, setPwdModal] = useState<any | null>(null);
  const [newPwd, setNewPwd] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiFetch('/panel/admins');
      setAdmins(Array.isArray(d?.admins) ? d.admins : (Array.isArray(d) ? d : []));
    } catch (e: any) {
      onToast('Ошибка загрузки админов', e.message, 'error');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ username: '', password: '', telegram_id: '', is_superadmin: false, is_active: true, permissions: emptyPerms() });
    setModal('add');
  };

  const openEdit = (a: any) => {
    setEditing(a);
    setForm({
      username: a.username || '',
      password: '',
      telegram_id: a.telegram_id != null ? String(a.telegram_id) : '',
      is_superadmin: !!a.is_superadmin,
      is_active: a.is_active !== false && a.is_active !== 0,
      permissions: { ...emptyPerms(), ...(a.permissions || {}) },
    });
    setModal('edit');
  };

  const save = async () => {
    if (!form.username.trim()) { onToast('Укажите логин', undefined, 'error'); return; }
    if (!form.telegram_id.trim()) { onToast('Укажите Telegram ID', undefined, 'error'); return; }
    if (modal === 'add' && form.password.length < 8) { onToast('Пароль минимум 8 символов', undefined, 'error'); return; }
    setSaving(true);
    try {
      if (modal === 'add') {
        await apiFetch('/panel/admins', {
          method: 'POST',
          body: JSON.stringify({
            username: form.username.trim(),
            password: form.password,
            telegram_id: parseInt(form.telegram_id, 10),
            is_superadmin: form.is_superadmin,
            permissions: form.is_superadmin ? emptyPerms() : form.permissions,
          }),
        });
        onToast('Админ создан', undefined, 'success');
      } else if (editing) {
        const body: any = {
          username: form.username.trim(),
          telegram_id: parseInt(form.telegram_id, 10),
          is_superadmin: form.is_superadmin,
          is_active: form.is_active,
          permissions: form.is_superadmin ? emptyPerms() : form.permissions,
        };
        if (form.password.length >= 8) body.password = form.password;
        await apiFetch(`/panel/admins/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
        onToast('Админ обновлён', undefined, 'success');
      }
      setModal(null);
      load();
    } catch (e: any) {
      onToast('Ошибка', e.message, 'error');
    }
    setSaving(false);
  };

  const remove = async (a: any) => {
    if (!confirm(`Удалить / деактивировать админа «${a.username}»?`)) return;
    try {
      await apiFetch(`/panel/admins/${a.id}`, { method: 'DELETE' });
      onToast('Админ удалён', undefined, 'success');
      load();
    } catch (e: any) {
      onToast('Ошибка', e.message, 'error');
    }
  };

  const changePwd = async () => {
    if (!pwdModal || newPwd.length < 8) { onToast('Пароль минимум 8 символов', undefined, 'error'); return; }
    try {
      await apiFetch(`/panel/admins/${pwdModal.id}/password`, {
        method: 'POST',
        body: JSON.stringify({ password: newPwd }),
      });
      onToast('Пароль изменён', undefined, 'success');
      setPwdModal(null);
      setNewPwd('');
    } catch (e: any) {
      onToast('Ошибка', e.message, 'error');
    }
  };

  if (loading) return <div className="flex items-center justify-center" style={{ height: 200 }}><Spinner size={28} /></div>;

  return (
    <div className="flex flex-col gap-6 rise">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="h-page">Роли</div>
          <div className="sub mt-1">Администраторы панели и права доступа</div>
        </div>
        {canEdit && (
          <button className="btn sm solid" onClick={openAdd}><Plus size={13} /> Добавить</button>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Логин</th>
                <th>Telegram ID</th>
                <th>Роль</th>
                <th>Активен</th>
                <th>Последний вход</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {admins.length === 0 ? (
                <tr className="empty-row"><td colSpan={6}>Нет администраторов</td></tr>
              ) : admins.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 500 }}>
                    {a.username}
                    {a.username === currentUsername && <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>(вы)</span>}
                  </td>
                  <td className="mono">{a.telegram_id ?? '—'}</td>
                  <td>{a.is_superadmin ? 'Супер‑админ' : 'Админ'}</td>
                  <td>{a.is_active === false || a.is_active === 0 ? <span className="muted">Нет</span> : 'Да'}</td>
                  <td className="muted">{fmtDate(a.last_login)}</td>
                  <td>
                    <div className="flex gap-1 justify-end">
                      {canEdit && (
                        <>
                          <button className="btn sm" title="Изменить" onClick={() => openEdit(a)}><Edit size={12} /></button>
                          <button className="btn sm" title="Сменить пароль" onClick={() => { setPwdModal(a); setNewPwd(''); }}><Lock size={12} /></button>
                          <button className="btn sm danger" title="Удалить" onClick={() => remove(a)}><Trash2 size={12} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal
          onClose={() => setModal(null)}
          title={modal === 'add' ? 'Новый админ' : 'Редактировать админа'}
          icon={Shield}
          width={560}
          footer={
            <div className="flex gap-2 justify-end">
              <button className="btn sm" onClick={() => setModal(null)}>Отмена</button>
              <button className="btn sm solid" disabled={saving} onClick={save}>
                {saving ? <Spinner size={14} /> : <><Save size={13} /> Сохранить</>}
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">Логин</label>
                <input className="input" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} />
              </div>
              <div>
                <label className="field-label">Telegram ID</label>
                <input className="input" value={form.telegram_id} onChange={e => setForm(p => ({ ...p, telegram_id: e.target.value }))} placeholder="123456789" />
              </div>
              <div>
                <label className="field-label">{modal === 'add' ? 'Пароль' : 'Новый пароль (опц.)'}</label>
                <input className="input" type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="мин. 8 символов" />
              </div>
              <div className="flex flex-col gap-2 justify-end pb-1">
                <label className="flex items-center gap-2" style={{ fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_superadmin} onChange={e => setForm(p => ({ ...p, is_superadmin: e.target.checked }))} />
                  Супер‑админ (полный доступ)
                </label>
                {modal === 'edit' && (
                  <label className="flex items-center gap-2" style={{ fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} />
                    Активен
                  </label>
                )}
              </div>
            </div>
            {form.is_superadmin ? (
              <p className="sub" style={{ fontSize: 13 }}>Супер‑админ имеет полный доступ ко всем разделам. Матрица прав отключена.</p>
            ) : (
              <>
                <div className="field-label mb-1">Права доступа</div>
                <PermissionsMatrix
                  value={form.permissions}
                  onChange={perms => setForm(p => ({ ...p, permissions: perms }))}
                />
              </>
            )}
          </div>
        </Modal>
      )}

      {pwdModal && (
        <Modal
          onClose={() => setPwdModal(null)}
          title={`Пароль: ${pwdModal.username}`}
          icon={Lock}
          width={400}
          footer={
            <div className="flex gap-2 justify-end">
              <button className="btn sm" onClick={() => setPwdModal(null)}>Отмена</button>
              <button className="btn sm solid" onClick={changePwd}><Check size={13} /> Сменить</button>
            </div>
          }
        >
          <label className="field-label">Новый пароль</label>
          <input className="input" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="минимум 8 символов" />
        </Modal>
      )}
    </div>
  );
};

const SettingsPage: React.FC<{ onToast: (t: string, m?: string, ty?: ToastType) => void; onLogout: () => void }> = ({ onToast, onLogout }) => {
  const [loading, setLoading] = useState(true);
  const [savingBackup, setSavingBackup] = useState(false);
  const [savingTariffs, setSavingTariffs] = useState(false);
  const [sendingBackup, setSendingBackup] = useState(false);
  const [savingPay, setSavingPay] = useState(false);
  // Backup
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [intervalMin, setIntervalMin] = useState(360);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  // Tariff plans
  const [tariffs, setTariffs] = useState<any[]>([]);
  const [editingTariff, setEditingTariff] = useState<any | null>(null);
  const [newTariff, setNewTariff] = useState({ plan_type: 'vpn_regular', name: '', price: '', duration_days: '30' });
  const [showNewTariff, setShowNewTariff] = useState(false);
  // Trial settings
  const [trialTariffId, setTrialTariffId] = useState('');
  const [trialDevices, setTrialDevices] = useState(1);
  const [paidDevices, setPaidDevices] = useState(2);
  const [familyDevices, setFamilyDevices] = useState(5);
  const [trialTrafficGb, setTrialTrafficGb] = useState(10);
  const [paidTrafficGb, setPaidTrafficGb] = useState(10240);
  const [familyTrafficGb, setFamilyTrafficGb] = useState(10240);
  // T-Bank
  const [tbTerminal, setTbTerminal] = useState('');
  const [tbPassword, setTbPassword] = useState('');
  const [tbApiUrl, setTbApiUrl] = useState('https://securepay.tinkoff.ru');
  const [tbTaxation, setTbTaxation] = useState('');
  const [tbVat, setTbVat] = useState('none');
  const [tbHasPassword, setTbHasPassword] = useState(false);
  const [tbConfigured, setTbConfigured] = useState(false);
  const [tbNotifyHint, setTbNotifyHint] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [bk, tr, sys, pay] = await Promise.all([
        apiFetch('/panel/backups/status'),
        apiFetch('/panel/tariffs'),
        apiFetch('/panel/system-settings'),
        apiFetch('/panel/payment-settings').catch(() => null),
      ]);
      if (bk) { setBackupEnabled(!!bk.enabled); setIntervalMin(bk.interval_minutes || 360); setLastBackup(bk.last_backup || null); }
      if (tr) setTariffs(Array.isArray(tr) ? tr : (tr.tariffs || []));
      if (sys) { setTrialTariffId(String(sys.trial_tariff_id || '')); setTrialDevices(sys.trial_devices_limit || 1); setPaidDevices(sys.paid_devices_limit || 2); setFamilyDevices(sys.family_devices_limit || 5); setTrialTrafficGb(sys.trial_traffic_gb || 10); setPaidTrafficGb(sys.paid_traffic_gb || 10240); setFamilyTrafficGb(sys.family_traffic_gb || 10240); }
      const tb = pay?.tbank || {};
      setTbTerminal(tb.terminal_key || '');
      setTbApiUrl(tb.api_url || 'https://securepay.tinkoff.ru');
      setTbTaxation(tb.taxation || '');
      setTbVat(tb.vat || 'none');
      setTbHasPassword(tb.has_password === '1' || tb.has_password === true);
      setTbConfigured(tb.configured === '1' || tb.configured === true);
      setTbNotifyHint(tb.notification_url_hint || '');
      setTbPassword('');
    } catch (e: any) { onToast('Ошибка загрузки настроек', e.message, 'error'); }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const saveBackup = async () => {
    setSavingBackup(true);
    try {
      await apiFetch('/panel/backups/settings', { method: 'PUT', body: JSON.stringify({ enabled: backupEnabled, interval_minutes: intervalMin }) });
      onToast('Настройки бэкапов сохранены', undefined, 'success');
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
    setSavingBackup(false);
  };

  const sendBackupNow = async () => {
    setSendingBackup(true);
    try {
      await apiFetch('/panel/backups/create', { method: 'POST' });
      onToast('Бэкап отправлен в Telegram', undefined, 'success');
      setLastBackup(new Date().toISOString());
    } catch (e: any) { onToast('Ошибка отправки бэкапа', e.message, 'error'); }
    setSendingBackup(false);
  };

  const saveTariffSettings = async () => {
    setSavingTariffs(true);
    try {
      await apiFetch('/panel/system-settings', { method: 'PUT', body: JSON.stringify({ trial_tariff_id: trialTariffId, trial_devices_limit: trialDevices, paid_devices_limit: paidDevices, family_devices_limit: familyDevices, trial_traffic_gb: trialTrafficGb, paid_traffic_gb: paidTrafficGb, family_traffic_gb: familyTrafficGb }) });
      onToast('Настройки тарифов сохранены', undefined, 'success');
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
    setSavingTariffs(false);
  };

  const saveTariffEdit = async () => {
    if (!editingTariff) return;
    try {
      await apiFetch(`/panel/tariffs/${editingTariff.id}`, { method: 'PUT', body: JSON.stringify({ name: editingTariff.name, price: parseFloat(editingTariff.price), duration_days: parseInt(editingTariff.duration_days), plan_type: editingTariff.plan_type }) });
      onToast('Тариф обновлён', undefined, 'success');
      setEditingTariff(null);
      loadAll();
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
  };

  const addTariff = async () => {
    if (!newTariff.name || !newTariff.price) return;
    try {
      await apiFetch('/panel/tariffs', { method: 'POST', body: JSON.stringify({ plan_type: newTariff.plan_type, name: newTariff.name, price: parseFloat(newTariff.price), duration_days: parseInt(newTariff.duration_days) }) });
      onToast('Тариф добавлен', undefined, 'success');
      setShowNewTariff(false);
      setNewTariff({ plan_type: 'vpn_regular', name: '', price: '', duration_days: '30' });
      loadAll();
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
  };

  const deleteTariff = async (id: number) => {
    if (!confirm('Удалить тариф?')) return;
    try {
      await apiFetch(`/panel/tariffs/${id}`, { method: 'DELETE' });
      onToast('Тариф удалён', undefined, 'success');
      loadAll();
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
  };

  const changePassword = async () => {
    const newPwd = prompt('Новый пароль (минимум 8 символов):');
    if (!newPwd || newPwd.length < 8) return;
    try {
      await apiFetch('/panel/auth/change-password', { method: 'POST', body: JSON.stringify({ new_password: newPwd }) });
      onToast('Пароль изменён', undefined, 'success');
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
  };

  const saveTbank = async () => {
    setSavingPay(true);
    try {
      const body: Record<string, string> = {
        terminal_key: tbTerminal.trim(),
        api_url: tbApiUrl.trim() || 'https://securepay.tinkoff.ru',
        taxation: tbTaxation.trim(),
        vat: tbVat.trim() || 'none',
      };
      if (tbPassword.trim()) body.password = tbPassword.trim();
      if (tbNotifyHint.trim()) body.notification_url = tbNotifyHint.trim();
      await apiFetch('/panel/payment-settings/tbank', { method: 'PUT', body: JSON.stringify(body) });
      onToast('Настройки Т‑Банка сохранены', undefined, 'success');
      setTbPassword('');
      loadAll();
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
    setSavingPay(false);
  };

  const fmtInterval = (min: number) => {
    if (min < 60) return `${min} мин`;
    const h = Math.floor(min / 60), m = min % 60;
    return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  };

  const planLabel = (pt: string) => pt === 'vpn_family' ? 'Семейный' : 'Обычный';

  if (loading) return <div className="flex items-center justify-center" style={{ height: 200 }}><Spinner size={28} /></div>;

  const regularTariffs = tariffs.filter(t => t.plan_type === 'vpn_regular');
  const familyTariffs = tariffs.filter(t => t.plan_type === 'vpn_family');

  return (
    <div className="flex flex-col gap-6 rise">
      <div><div className="h-page">Настройки</div><div className="sub mt-1">Управление системой</div></div>

      {/* ── Т‑БАНК ── */}
      <div className="card" style={{ padding: 24 }}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="h-sec">Т‑Банк эквайринг</h3>
          <span className={`badge ${tbConfigured ? 'solid' : 'line'}`}>{tbConfigured ? 'Настроен' : 'Не настроен'}</span>
        </div>
        <p className="sub mb-4" style={{ fontSize: 13 }}>
          TerminalKey и пароль из личного кабинета интернет-эквайринга.{' '}
          <a href="https://developer.tbank.ru/eacq/intro" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Документация</a>
        </p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="field-label">Terminal Key</label>
            <input className="input" value={tbTerminal} onChange={e => setTbTerminal(e.target.value)} placeholder="Tinkoff..." autoComplete="off" />
          </div>
          <div>
            <label className="field-label">Пароль терминала {tbHasPassword ? '(сохранён)' : ''}</label>
            <input className="input" type="password" value={tbPassword} onChange={e => setTbPassword(e.target.value)} placeholder={tbHasPassword ? '•••••••• (оставьте пустым, чтобы не менять)' : 'Пароль из ЛК'} autoComplete="new-password" />
          </div>
          <div>
            <label className="field-label">API URL</label>
            <input className="input" value={tbApiUrl} onChange={e => setTbApiUrl(e.target.value)} placeholder="https://securepay.tinkoff.ru" />
          </div>
          <div>
            <label className="field-label">Система налогообложения (для чека)</label>
            <input className="input" value={tbTaxation} onChange={e => setTbTaxation(e.target.value)} placeholder="пусто = без чека; usn_income / osn / ..." />
          </div>
          <div>
            <label className="field-label">НДС в чеке</label>
            <select className="select" value={tbVat} onChange={e => setTbVat(e.target.value)}>
              <option value="none">none</option>
              <option value="vat0">vat0</option>
              <option value="vat10">vat10</option>
              <option value="vat20">vat20</option>
            </select>
          </div>
        </div>
        <div className="inset mb-4" style={{ padding: 12, fontSize: 12 }}>
          <div className="eyebrow mb-1">NotificationURL</div>
          <code style={{ wordBreak: 'break-all' }}>{tbNotifyHint || 'https://ВАШ_ДОМЕН/tbank'}</code>
          <div className="sub mt-1">Укажите этот URL в ЛК Т‑Банка (уведомления о платежах).</div>
        </div>
        <button className="btn solid" disabled={savingPay} onClick={saveTbank}>
          {savingPay ? <Spinner size={14} /> : <><Save size={14} /> Сохранить Т‑Банк</>}
        </button>
      </div>

      {/* ── ТАРИФЫ ── */}
      <div className="card" style={{ padding: 24 }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="h-sec">Тарифные планы</h3>
          <button className="btn sm solid" onClick={() => setShowNewTariff(v => !v)}><Plus size={13} /> Добавить</button>
        </div>

        {showNewTariff && (
          <div className="inset mb-4" style={{ padding: 16 }}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="field-label">Тип тарифа</label>
                <select className="select" value={newTariff.plan_type} onChange={e => setNewTariff(p => ({ ...p, plan_type: e.target.value }))}>
                  <option value="vpn_regular">Обычный</option>
                  <option value="vpn_family">Семейный</option>
                </select>
              </div>
              <div>
                <label className="field-label">Название</label>
                <input className="input" value={newTariff.name} onChange={e => setNewTariff(p => ({ ...p, name: e.target.value }))} placeholder="1 месяц" />
              </div>
              <div>
                <label className="field-label">Цена (₽)</label>
                <input className="input" type="number" value={newTariff.price} onChange={e => setNewTariff(p => ({ ...p, price: e.target.value }))} placeholder="499" />
              </div>
              <div>
                <label className="field-label">Дней</label>
                <input className="input" type="number" value={newTariff.duration_days} onChange={e => setNewTariff(p => ({ ...p, duration_days: e.target.value }))} placeholder="30" />
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn solid sm" onClick={addTariff}><Check size={13} /> Сохранить</button>
              <button className="btn sm" onClick={() => setShowNewTariff(false)}>Отмена</button>
            </div>
          </div>
        )}

        {[['Обычный (vpn_regular)', regularTariffs], ['Семейный (vpn_family)', familyTariffs]].map(([label, list]: any) => (
          <div key={label} className="mb-4">
            <div className="eyebrow mb-2">{label}</div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Название</th><th>Цена</th><th>Дней</th><th></th></tr></thead>
                <tbody>
                  {list.length === 0
                    ? <tr className="empty-row"><td colSpan={4}>Нет тарифов</td></tr>
                    : list.map((t: any) => editingTariff?.id === t.id ? (
                      <tr key={t.id}>
                        <td><input className="input" style={{ padding: '4px 8px', fontSize: 13 }} value={editingTariff.name} onChange={e => setEditingTariff((p: any) => ({ ...p, name: e.target.value }))} /></td>
                        <td><input className="input" style={{ padding: '4px 8px', fontSize: 13, width: 80 }} type="number" value={editingTariff.price} onChange={e => setEditingTariff((p: any) => ({ ...p, price: e.target.value }))} /></td>
                        <td><input className="input" style={{ padding: '4px 8px', fontSize: 13, width: 70 }} type="number" value={editingTariff.duration_days} onChange={e => setEditingTariff((p: any) => ({ ...p, duration_days: e.target.value }))} /></td>
                        <td className="flex gap-1">
                          <button className="btn sm solid" onClick={saveTariffEdit}><Check size={12} /></button>
                          <button className="btn sm" onClick={() => setEditingTariff(null)}><X size={12} /></button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={t.id}>
                        <td style={{ fontWeight: 500 }}>{t.name}</td>
                        <td className="mono">{t.price} ₽</td>
                        <td className="muted">{t.duration_days} дн.</td>
                        <td className="flex gap-1">
                          <button className="btn sm" onClick={() => setEditingTariff({ ...t })}><Edit size={12} /></button>
                          <button className="btn sm danger" onClick={() => deleteTariff(t.id)}><Trash2 size={12} /></button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* ── ТАРИФ ПОСЛЕ ТРИАЛА И ЛИМИТЫ ── */}
      <div className="card" style={{ padding: 24 }}>
        <h3 className="h-sec mb-1">Лимиты подписок</h3>
        <p className="sub mb-4" style={{ fontSize: 13 }}>Настройте тариф после триала и лимиты устройств/трафика для каждого типа подписки.</p>
        <div className="flex flex-col gap-5">

          {/* Тариф после триала */}
          <div>
            <label className="field-label">Тариф для автоконвертации после триала</label>
            <select className="select" value={trialTariffId} onChange={e => setTrialTariffId(e.target.value)}>
              <option value="">— не выбран (дефолт: 399₽ / 30 дн.) —</option>
              {tariffs.map(t => (
                <option key={t.id} value={String(t.id)}>
                  [{planLabel(t.plan_type)}] {t.name} — {t.price}₽ / {t.duration_days} дн.
                </option>
              ))}
            </select>
            <div className="sub mt-1" style={{ fontSize: 12 }}>После окончания триала рекуррент спишет именно эту сумму и продлит на этот срок</div>
          </div>

          {/* Устройства по типам */}
          <div>
            <div className="field-label mb-2">Лимит устройств (HWID)</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="inset" style={{ padding: 12 }}>
                <div className="eyebrow mb-2">🔬 Триал</div>
                <input className="input" type="number" min="1" max="20" value={trialDevices}
                  onChange={e => setTrialDevices(parseInt(e.target.value) || 1)} style={{ maxWidth: 80 }} />
                <div className="sub mt-1" style={{ fontSize: 11 }}>По умолчанию: 1</div>
              </div>
              <div className="inset" style={{ padding: 12 }}>
                <div className="eyebrow mb-2">📱 Обычный</div>
                <input className="input" type="number" min="1" max="20" value={paidDevices}
                  onChange={e => setPaidDevices(parseInt(e.target.value) || 2)} style={{ maxWidth: 80 }} />
                <div className="sub mt-1" style={{ fontSize: 11 }}>По умолчанию: 2</div>
              </div>
              <div className="inset" style={{ padding: 12 }}>
                <div className="eyebrow mb-2">👨‍👩‍👧 Семейный</div>
                <input className="input" type="number" min="1" max="20" value={familyDevices}
                  onChange={e => setFamilyDevices(parseInt(e.target.value) || 5)} style={{ maxWidth: 80 }} />
                <div className="sub mt-1" style={{ fontSize: 11 }}>По умолчанию: 5</div>
              </div>
            </div>
          </div>

          {/* Трафик */}
          <div>
            <div className="field-label mb-2">Лимит трафика (ГБ)</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="inset" style={{ padding: 12 }}>
                <div className="eyebrow mb-2">🔬 Триал</div>
                <input className="input" type="number" min="1" value={trialTrafficGb}
                  onChange={e => setTrialTrafficGb(parseInt(e.target.value) || 10)} style={{ maxWidth: 90 }} />
                <div className="sub mt-1" style={{ fontSize: 11 }}>По умолчанию: 10 ГБ</div>
              </div>
              <div className="inset" style={{ padding: 12 }}>
                <div className="eyebrow mb-2">📱 Обычный</div>
                <input className="input" type="number" min="1" value={paidTrafficGb}
                  onChange={e => setPaidTrafficGb(parseInt(e.target.value) || 10240)} style={{ maxWidth: 90 }} />
                <div className="sub mt-1" style={{ fontSize: 11 }}>По умолчанию: 10 240 ГБ (10 ТБ)</div>
              </div>
              <div className="inset" style={{ padding: 12 }}>
                <div className="eyebrow mb-2">👨‍👩‍👧 Семейный</div>
                <input className="input" type="number" min="1" value={familyTrafficGb}
                  onChange={e => setFamilyTrafficGb(parseInt(e.target.value) || 10240)} style={{ maxWidth: 90 }} />
                <div className="sub mt-1" style={{ fontSize: 11 }}>По умолчанию: 10 240 ГБ (10 ТБ)</div>
              </div>
            </div>
          </div>

        </div>
        <button className="btn solid mt-5" disabled={savingTariffs} onClick={saveTariffSettings}>
          {savingTariffs ? <Spinner size={14} /> : <><Save size={14} /> Сохранить настройки подписок</>}
        </button>
      </div>

      {/* ── БЭКАПЫ ── */}
      <div className="card" style={{ padding: 24 }}>
        <h3 className="h-sec mb-4">Автоматические бэкапы</h3>
        <p className="sub mb-4" style={{ fontSize: 13 }}>Бэкап базы данных отправляется всем администраторам в Telegram ровно в xx:00 выбранного периода.</p>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <input type="checkbox" id="backup-enabled" checked={backupEnabled} onChange={e => setBackupEnabled(e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
            <label htmlFor="backup-enabled" style={{ fontSize: 14, cursor: 'pointer' }}>Включить автоматические бэкапы</label>
          </div>
          <div>
            <label className="field-label">Интервал (минуты)</label>
            <div className="flex items-center gap-3">
              <input className="input" type="number" min="10" max="10080" value={intervalMin} onChange={e => setIntervalMin(Math.max(10, parseInt(e.target.value) || 360))} style={{ maxWidth: 140 }} />
              <span className="muted" style={{ fontSize: 13 }}>= {fmtInterval(intervalMin)}</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {[60, 180, 360, 720, 1440].map(v => (
                <button key={v} className={`btn sm ${intervalMin === v ? 'solid' : ''}`} onClick={() => setIntervalMin(v)}>{fmtInterval(v)}</button>
              ))}
            </div>
          </div>
          {lastBackup && <div className="sub" style={{ fontSize: 12 }}>Последний бэкап: {new Date(lastBackup).toLocaleString('ru-RU')}</div>}
        </div>
        <div className="flex gap-3 mt-5 flex-wrap">
          <button className="btn solid" disabled={savingBackup} onClick={saveBackup}>{savingBackup ? <Spinner size={14} /> : <><Save size={14} /> Сохранить</>}</button>
          <button className="btn" disabled={sendingBackup} onClick={sendBackupNow}>{sendingBackup ? <Spinner size={14} /> : <><Database size={14} /> Отправить бэкап сейчас</>}</button>
        </div>
      </div>

      {/* ── БЕЗОПАСНОСТЬ ── */}
      <div className="card" style={{ padding: 24 }}>
        <h3 className="h-sec mb-4">Безопасность</h3>
        <div className="flex gap-3 flex-wrap">
          <button className="btn" onClick={changePassword}><Lock size={14} /> Изменить пароль</button>
          <button className="btn danger" onClick={onLogout}><X size={14} /> Выйти из системы</button>
        </div>
      </div>
    </div>
  );
};

// ─── MAIN APP ─────────────────────────────────────────────────────
function AuthenticatedApp({ onLogout }: { onLogout: () => void }) {
  const { toasts, add: addToast, remove: removeToast } = useToast();
  const [activePage, setActivePage] = useState('Главная');
  const [openUserId, setOpenUserId] = useState<number | null>(null);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [username, setUsername] = useState('');
  const [permsReady, setPermsReady] = useState(false);

  const [transactions, setTransactions] = useState<any[]>([]);
  const [selectedTx, setSelectedTx] = useState<any | null>(null);
  const [totalRevenue, setTotalRevenue] = useState(0);

  const canView = useCallback((pageName: string) => {
    if (isSuperadmin) return true;
    const key = PAGE_TO_PERM[pageName];
    if (!key) return true;
    const lvl = permissions[key] || 'none';
    return lvl === 'view' || lvl === 'edit';
  }, [isSuperadmin, permissions]);

  const canEdit = useCallback((pageName: string) => {
    if (isSuperadmin) return true;
    const key = PAGE_TO_PERM[pageName];
    if (!key) return true;
    return (permissions[key] || 'none') === 'edit';
  }, [isSuperadmin, permissions]);

  useEffect(() => {
    apiFetch('/panel/auth/check')
      .then(d => {
        if (!d?.authenticated) return;
        setPermissions(d.permissions || {});
        setIsSuperadmin(!!d.is_superadmin);
        setUsername(d.username || '');
        setPermsReady(true);
      })
      .catch(() => setPermsReady(true));
  }, []);

  useEffect(() => {
    if (!permsReady) return;
    if (!canView(activePage)) {
      const first = ROLE_TABS.find(t => {
        const name = Object.keys(PAGE_TO_PERM).find(n => PAGE_TO_PERM[n] === t.key);
        return name ? canView(name) : false;
      });
      if (first) {
        const name = Object.keys(PAGE_TO_PERM).find(n => PAGE_TO_PERM[n] === first.key);
        if (name) setActivePage(name);
      }
    }
  }, [permsReady, permissions, isSuperadmin, activePage, canView]);

  useEffect(() => {
    apiFetch('/panel/stats/summary').then(d => { if (d) setTotalRevenue(d.monthly_revenue || 0); }).catch(() => {});
  }, []);

  const loadFinance = useCallback(() => {
    apiFetch('/panel/transactions').then(d => {
      const raw = Array.isArray(d) ? d : (d?.transactions || []);
      setTransactions(raw.map((tx: any) => ({
        id: tx.id,
        user: tx.user || tx.username || tx.telegram_id || '—',
        amount: Math.abs(tx.amount || 0),
        type: tx.type || 'subscription',
        status: tx.status || '—',
        method: tx.payment_method || tx.payment_provider || '—',
        date: tx.created_at ? new Date(tx.created_at).toLocaleDateString('ru-RU') : '—',
        hash: tx.hash || tx.payment_id || '',
        payment_id: tx.payment_id || tx.hash || '',
      })));
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (activePage === 'Финансы') loadFinance();
  }, [activePage, loadFinance]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uid = params.get('uid');
    const tg = params.get('tg');
    if (uid && /^\d+$/.test(uid)) {
      setOpenUserId(parseInt(uid));
      setActivePage('Пользователи');
      return;
    }
    if (tg && /^\d+$/.test(tg)) {
      (async () => {
        try {
          const d = await apiFetch(`/panel/users/by-telegram/${tg}`);
          if (d?.id) {
            setOpenUserId(d.id);
            setActivePage('Пользователи');
          }
        } catch (e) {
          console.error(e);
        }
      })();
    }
  }, []);

  const openUser = (userId: number) => {
    setOpenUserId(userId);
    const url = new URL(window.location.href);
    url.searchParams.delete('tg');
    url.searchParams.delete('user');
    url.searchParams.set('uid', String(userId));
    window.history.pushState({}, '', url.toString());
  };

  const closeUser = () => {
    setOpenUserId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('user');
    url.searchParams.delete('tg');
    url.searchParams.delete('uid');
    window.history.pushState({}, '', url.toString());
  };

  const nav = [
    { group: 'Главное', items: [{ name: 'Главная', icon: Home }, { name: 'Финансы', icon: DollarSign }, { name: 'Статистика', icon: BarChart2 }] },
    { group: 'Данные', items: [{ name: 'Пользователи', icon: Users }] },
    { group: 'Маркетинг', items: [{ name: 'Рассылка', icon: Mail }, { name: 'Промокоды', icon: Gift }] },
    { group: 'Система', items: [{ name: 'Сквады', icon: Layers }, { name: 'Настройки', icon: Settings }, { name: 'Роли', icon: Shield }] },
  ].map(section => ({
    ...section,
    items: section.items.filter(item => canView(item.name)),
  })).filter(section => section.items.length > 0);

  return (
    <div className="panel-shell">
      <ToastContainer toasts={toasts} remove={removeToast} />

      <aside className={`panel-sidebar ${isMobileOpen ? 'open' : ''}`}>
        <div className="panel-sidebar-brand">
          <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>1FEDERAL</div>
          <div className="sub" style={{ fontSize: 11, marginTop: 2 }}>
            {username ? `@${username}` : 'Admin Panel'}{isSuperadmin ? ' · full' : ''}
          </div>
          <button type="button" className="icon-btn panel-sidebar-close" onClick={() => setIsMobileOpen(false)} aria-label="Закрыть меню">
            <X size={17} />
          </button>
        </div>
        <nav className="panel-sidebar-nav">
          {nav.map(section => (
            <div key={section.group} style={{ marginBottom: 18 }}>
              <div className="nav-group" style={{ marginBottom: 4 }}>{section.group}</div>
              {section.items.map(item => (
                <button key={item.name}
                  type="button"
                  className={`nav-item ${activePage === item.name && !openUserId ? 'on' : ''}`}
                  onClick={() => { setActivePage(item.name); closeUser(); setIsMobileOpen(false); }}>
                  <item.icon size={15} className={activePage === item.name && !openUserId ? '' : 'faint'} />
                  {item.name}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="panel-sidebar-foot">
          <button type="button" className="btn ghost block" onClick={onLogout} style={{ justifyContent: 'flex-start', gap: 10 }}>
            <Lock size={14} className="faint" /> Выйти
          </button>
        </div>
      </aside>

      {isMobileOpen && (
        <button type="button" className="panel-backdrop" aria-label="Закрыть меню" onClick={() => setIsMobileOpen(false)} />
      )}

      <main className="panel-main">
        <div className="panel-topbar">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" className="icon-btn panel-menu-btn" onClick={() => setIsMobileOpen(v => !v)} aria-label="Меню">
              {isMobileOpen ? <X size={17} /> : <Menu size={17} />}
            </button>
            <span className="panel-topbar-title">
              {openUserId ? `Пользователь #${openUserId}` : activePage}
            </span>
          </div>
          <div className="inset panel-topbar-rev">
            <DollarSign size={13} className="faint" />
            <span style={{ fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {totalRevenue.toLocaleString('ru-RU')} ₽
            </span>
          </div>
        </div>

        <div className="panel-page">
          {!canView(activePage) ? (
            <div className="card rise" style={{ padding: 40, textAlign: 'center' }}>
              <Shield size={28} className="faint" style={{ margin: '0 auto 12px' }} />
              <div className="h-sec">403 — доступ запрещён</div>
              <p className="sub mt-2">Нет прав на раздел «{activePage}».</p>
            </div>
          ) : openUserId && activePage === 'Пользователи' ? (
            <UserDetailPage
              userId={openUserId}
              onBack={() => closeUser()}
              onToast={addToast}
            />
          ) : (
            <>
              {activePage === 'Главная' && <Dashboard onNavigate={(page) => { setActivePage(page); closeUser(); }} onToast={addToast} />}
              {activePage === 'Финансы' && (
                <>
                  <FinancePage transactions={transactions} onSelect={setSelectedTx} />
                  {selectedTx && (
                    <TransactionModal
                      tx={selectedTx}
                      onClose={() => setSelectedTx(null)}
                      onRefunded={loadFinance}
                      onToast={addToast}
                    />
                  )}
                </>
              )}
              {activePage === 'Статистика' && <StatisticsPage />}
              {activePage === 'Пользователи' && <UsersPage onOpenUser={openUser} />}
              {activePage === 'Рассылка' && <MailingPage onToast={addToast} />}
              {activePage === 'Промокоды' && <PromocodesPage onToast={addToast} />}
              {activePage === 'Сквады' && <SquadsPage onToast={addToast} />}
              {activePage === 'Настройки' && <SettingsPage onToast={addToast} onLogout={onLogout} />}
              {activePage === 'Роли' && (
                <RolesPage
                  onToast={addToast}
                  currentUsername={username}
                  canEdit={canEdit('Роли')}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const secret = getPanelSecret();
    if (!secret) { setIsAuthenticated(false); return; }
    apiFetch('/panel/auth/check')
      .then(d => setIsAuthenticated(!!(d && d.authenticated)))
      .catch(() => setIsAuthenticated(false));
  }, []);

  if (isAuthenticated === null) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader size={28} className="animate-spin faint" />
    </div>
  );

  if (!isAuthenticated) return <LoginForm onLogin={secret => { setPanelSecret(secret); setIsAuthenticated(true); }} />;
  return <AuthenticatedApp onLogout={() => { clearPanelSecret(); setIsAuthenticated(false); }} />;
}
