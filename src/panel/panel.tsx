import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Home, DollarSign, Users, Key, Mail, Gift, Settings, Menu, X,
  CheckCircle, AlertCircle, Search, Filter, ArrowUpRight, ArrowDownLeft,
  Activity, Loader, Ban, UserPlus, UserMinus, Clock, Edit2, Copy,
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

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const url = `/api${path.startsWith('/') ? path : '/' + path}`;
  const headers: any = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (path.startsWith('/panel')) {
    const s = getPanelSecret();
    if (s) headers['Authorization'] = `Bearer ${s}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    if (res.status === 401) { clearPanelSecret(); window.location.reload(); }
    const t = await res.text();
    throw new Error(t || `HTTP ${res.status}`);
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
  transactions: DBTransaction[]; db_keys: DBKey[]; remnawave_keys: RWKey[];
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
const Dashboard: React.FC = () => {
  const [summary, setSummary] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [period, setPeriod] = useState<'7' | '30' | '365'>('30');

  useEffect(() => {
    apiFetch('/panel/stats/summary').then(d => d && setSummary(d)).catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/panel/statistics/full?period=${period}`).then(d => { if (!cancelled && d) setStats(d); }).catch(console.error);
    return () => { cancelled = true; };
  }, [period]);

  const fmtM2 = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M ₽` : fmtM(v);

  const revenueSeries = (() => {
    const raw = stats?.revenueByDay ?? stats?.dailyRevenue ?? stats?.revenue_by_day ?? stats?.chart ?? [];
    const labels = stats?.revenueLabels ?? [];
    if (!Array.isArray(raw)) return [];
    if (raw.length > 0 && typeof raw[0] === 'number')
      return raw.map((v: number, i: number) => ({ label: labels[i] || String(i + 1), value: v }));
    return raw.map((d: any) => ({
      label: String(d.label ?? d.date ?? d.day ?? ''),
      value: Number(d.value ?? d.amount ?? d.revenue ?? d.total ?? d.count ?? 0) || 0,
    }));
  })();

  return (
    <div className="flex flex-col gap-6 rise">
      <div><div className="h-page">Панель управления</div><div className="sub mt-1">Обзор 1FEDERAL VPN</div></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat title="Пользователи" value={summary ? fmtN(summary.total_users) : '—'} icon={Users} />
        <Stat title="Активные ключи" value={summary ? fmtN(summary.active_keys) : '—'} icon={Key} />
        <Stat title="Доход за месяц" value={summary ? fmtM2(summary.monthly_revenue) : '—'} icon={DollarSign} />
        <Stat title="Платежей сегодня" value={stats ? fmtN(stats.paymentsToday) : '—'} icon={CreditCard} />
      </div>
      {stats && (
        <>
          <div className="card" style={{ padding: 24 }}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="h-sec">Выручка</h3>
              <div className="seg">
                {([['7', 'Неделя'], ['30', '30 дней'], ['365', 'Год']] as const).map(([v, l]) => (
                  <button key={v} className={`seg-item ${period === v ? 'on' : ''}`} onClick={() => setPeriod(v)}>{l}</button>
                ))}
              </div>
            </div>
            {revenueSeries.length > 0 && <BarChart data={revenueSeries} format={v => fmtM2(v)} height={180} />}
            <div className="grid grid-cols-3 gap-3 mt-6">
              <div className="inset" style={{ padding: 14 }}><div className="sub">В среднем в день</div><div className="stat-value mt-1">{fmtM2(stats.avgDaily || 0)}</div></div>
              <div className="inset" style={{ padding: 14 }}><div className="sub">Лучший день</div><div className="stat-value mt-1">{fmtM2(stats.bestDayValue || 0)}</div><div className="faint" style={{ fontSize: 11 }}>{stats.bestDayDate || ''}</div></div>
              <div className="inset" style={{ padding: 14 }}><div className="sub">Куплено за неделю</div><div className="stat-value mt-1">+{fmtN(stats.boughtThisWeek)}</div></div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card" style={{ padding: 20 }}>
              <h3 className="h-sec mb-4">Подписки</h3>
              {[['Всего', stats.totalSubscriptions], ['Платные', stats.paidSubscriptions], ['За неделю', `+${fmtN(stats.boughtThisWeek)}`]].map(([l, v]) => (
                <div key={String(l)} className="flex justify-between" style={{ fontSize: 14, padding: '5px 0' }}><span className="muted">{l}</span><span style={{ fontWeight: 500 }}>{typeof v === 'number' ? fmtN(v) : v}</span></div>
              ))}
            </div>
            <div className="card" style={{ padding: 20 }}>
              <h3 className="h-sec mb-3">Конверсия trial → paid</h3>
              <div className="stat-value" style={{ fontSize: 32 }}>{stats.conversionRate?.toFixed(1) || 0}%</div>
              <div className="hbar mt-3"><i style={{ width: `${Math.min(stats.conversionRate || 0, 100)}%`, background: 'var(--text)' }} /></div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <h3 className="h-sec mb-4">Рефералы</h3>
              {[['Приглашено', fmtN(stats.totalInvited)], ['Партнёров', fmtN(stats.partners)], ['Выплачено', fmtM2(stats.totalPaid)]].map(([l, v]) => (
                <div key={String(l)} className="flex justify-between" style={{ fontSize: 14, padding: '5px 0' }}><span className="muted">{l}</span><span style={{ fontWeight: 500 }}>{v}</span></div>
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
        </>
      )}
    </div>
  );
};

// ─── FINANCE ──────────────────────────────────────────────────────
const FinancePage: React.FC<{ transactions: any[]; onSelect: (t: any) => void }> = ({ transactions, onSelect }) => {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => { apiFetch('/panel/finance/stats').then(d => d && setStats(d)).catch(console.error); }, []);
  return (
    <div className="flex flex-col gap-6 rise">
      <div><div className="h-page">Финансы</div><div className="sub mt-1">Доходы и операции</div></div>
      <div className="grid grid-cols-2 gap-4">
        <Stat title="Пополнения" value={stats ? fmtM(stats.deposits) : '—'} icon={ArrowUpRight} />
        <Stat title="Успешные операции" value={stats ? fmtN(stats.successfulOps) : '—'} icon={Activity} sub="операций" />
      </div>
      <div className="tbl-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>ID</th><th>Пользователь</th><th>Сумма</th><th>Статус</th><th>Дата</th></tr></thead>
            <tbody>
              {transactions.length === 0
                ? <tr className="empty-row"><td colSpan={5}>Пока нет операций</td></tr>
                : transactions.map(tx => (
                  <tr key={tx.id} className="click" onClick={() => onSelect(tx)}>
                    <td className="muted mono">#{tx.id}</td>
                    <td className="muted">{tx.user}</td>
                    <td style={{ fontWeight: 600, color: tx.amount > 0 ? 'var(--text)' : 'var(--muted)' }}>{tx.amount > 0 ? '+' : ''}{tx.amount} ₽</td>
                    <td className="muted">{tx.status}</td>
                    <td className="faint">{tx.date}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── TRANSACTION MODAL ───────────────────────────────────────────
const TransactionModal: React.FC<{ tx: any; onClose: () => void }> = ({ tx, onClose }) => (
  <Modal onClose={onClose} title={tx.amount > 0 ? 'Пополнение' : 'Списание'} icon={tx.amount > 0 ? ArrowUpRight : ArrowDownLeft} width={420}
    footer={<button className="btn block" onClick={onClose}>Закрыть</button>}>
    {[['ID', `#${tx.id}`], ['Пользователь', tx.user], ['Сумма', `${tx.amount > 0 ? '+' : ''}${tx.amount} ₽`], ['Метод', tx.method || '—'], ['Hash', tx.hash || '—'], ['Дата', tx.date]].map(([l, v]) => (
      <div key={String(l)} className="flex justify-between items-center" style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
        <span className="muted" style={{ fontSize: 13 }}>{l}</span>
        <span className="mono" style={{ fontSize: 13 }}>{v}</span>
      </div>
    ))}
  </Modal>
);

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
        <div className="flex justify-between items-center mb-5">
          <h3 className="h-sec">Выручка по дням</h3>
          <div className="seg">
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
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
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
  const [editEmail, setEditEmail] = useState('');
  const [editTelegram, setEditTelegram] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  // Modals
  const [banModal, setBanModal] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [extendModal, setExtendModal] = useState<{ rw_uuid: string; current_expire: string | null } | null>(null);
  const [extendDays, setExtendDays] = useState('');
  const [reduceModal, setReduceModal] = useState<{ rw_uuid: string } | null>(null);
  const [reduceDays, setReduceDays] = useState('');
  const [trafficModal, setTrafficModal] = useState<{ rw_uuid: string; current_gb: number } | null>(null);
  const [trafficGb, setTrafficGb] = useState('');
  const [devicesModal, setDevicesModal] = useState<{ rw_uuid: string; current: number | null } | null>(null);
  const [devicesVal, setDevicesVal] = useState('');
  const [notifMsg, setNotifMsg] = useState('');
  const [notifModal, setNotifModal] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch(`/panel/users/by-id/${userId}`);
      setUser(d);
      setEditRate(String(d.partner_rate ?? 20));
      setEditBalance(String(d.partner_balance ?? 0));
      setEditEmail(d.email || '');
      setEditTelegram(d.telegram_id != null ? String(d.telegram_id) : '');
    } catch (e: any) {
      onToast('Ошибка', e.message, 'error');
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

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
      setDevicesMap(prev => ({ ...prev, [rw_uuid]: Array.isArray(d) ? d : [] }));
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
              {[
                ['ID', String(user.id)],
                ['Telegram ID', user.telegram_id != null ? String(user.telegram_id) : '—'],
                ['Email', user.email || '—'],
                ['Username', user.username ? `@${user.username}` : '—'],
                ['Отображаемое имя', user.full_name || '—'],
                ['Реферальный код', user.referral_code || '—'],
                ['Регистрация', fmtDate(user.registration_date)],
                ['Статус', user.status],
              ].map(([l, v]) => (
                <div key={String(l)} className="inset" style={{ padding: 12 }}>
                  <div className="eyebrow mb-1">{l}</div>
                  <div className="flex items-center gap-2">
                    <span className="mono" style={{ fontSize: 13 }}>{v}</span>
                    {v && v !== '—' && <button onClick={() => copyText(String(v))} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}><Copy size={12} className="faint" /></button>}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="field-label">Email (привязка / смена)</label>
                <div className="flex gap-2">
                  <input className="input mono" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="user@example.com" />
                  <button className="btn solid" disabled={saving === 'set_email'} onClick={() => update('set_email', editEmail.trim() || null)}>
                    {saving === 'set_email' ? <Spinner size={14} /> : <Save size={14} />}
                  </button>
                </div>
                <div className="sub mt-1" style={{ fontSize: 11 }}>Пустое значение отвяжет email</div>
              </div>
              <div>
                <label className="field-label">Telegram ID (привязка / смена)</label>
                <div className="flex gap-2">
                  <input className="input mono" type="text" value={editTelegram} onChange={e => setEditTelegram(e.target.value)} placeholder="123456789" />
                  <button className="btn solid" disabled={saving === 'set_telegram'} onClick={() => update('set_telegram', editTelegram.trim() || null)}>
                    {saving === 'set_telegram' ? <Spinner size={14} /> : <Save size={14} />}
                  </button>
                </div>
                <div className="sub mt-1" style={{ fontSize: 11 }}>Пустое значение отвяжет Telegram (нужен email)</div>
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

                {/* Key info grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="eyebrow mb-1">Истекает</div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{rk.expire_at ? fmtDate(rk.expire_at) : '—'}</div>
                    {days !== null && <div className={`sub mt-1 ${days < 7 ? '' : ''}`}>{days > 0 ? `${days} дней` : 'Истёк'}</div>}
                  </div>
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="eyebrow mb-1">Последнее подключение</div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{fmtDate(rk.online_at)}</div>
                  </div>
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="eyebrow mb-1">Первое подключение</div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{fmtDate(rk.first_connected_at)}</div>
                  </div>
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="eyebrow mb-1">Трафик</div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{fmtGB(rk.traffic_used_bytes)} / {limitGb > 0 ? fmtGB(rk.traffic_limit_bytes) : '∞'}</div>
                    <div className="meter mt-2"><i className={usedPct > 90 ? 'crit' : usedPct > 70 ? 'warn' : ''} style={{ width: `${usedPct}%` }} /></div>
                  </div>
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="eyebrow mb-1">Лимит HWID-устройств</div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{rk.hwid_device_limit ?? '∞'}</div>
                  </div>
                  <div className="inset" style={{ padding: 12 }}>
                    <div className="eyebrow mb-1">Lifetime трафик</div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{fmtGB(rk.lifetime_traffic_bytes)}</div>
                  </div>
                </div>

                {/* Subscription URL */}
                <div className="inset mono" style={{ padding: 10, fontSize: 11, wordBreak: 'break-all', marginBottom: 14 }}>
                  {rk.subscription_url}
                  <button onClick={() => copyText(rk.subscription_url)} style={{ background: 'none', border: 0, cursor: 'pointer', marginLeft: 8 }}><Copy size={11} className="faint" /></button>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <button className="btn sm" onClick={() => { setExtendModal({ rw_uuid: rk.uuid, current_expire: rk.expire_at }); setExtendDays(''); }}><Plus size={13} /> Продлить</button>
                  <button className="btn sm" onClick={() => { setReduceModal({ rw_uuid: rk.uuid }); setReduceDays(''); }}><Clock size={13} /> Уменьшить срок</button>
                  <button className="btn sm" onClick={() => { setTrafficModal({ rw_uuid: rk.uuid, current_gb: limitGb }); setTrafficGb(String(limitGb.toFixed(0))); }}><Database size={13} /> Трафик</button>
                  <button className="btn sm" onClick={() => { setDevicesModal({ rw_uuid: rk.uuid, current: rk.hwid_device_limit }); setDevicesVal(String(rk.hwid_device_limit ?? '')); }}><Smartphone size={13} /> Устройства</button>
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
                  {devList && devList.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Нет привязанных устройств</p>}
                  {devList && devList.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {devList.map((dev, idx) => {
                        const devId = dev.id || dev.hwid || dev.uuid || String(idx);
                        return (
                          <div key={devId} className="inset" style={{ padding: 12 }}>
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div style={{ fontWeight: 500, fontSize: 13 }}>{dev.deviceName || dev.platform || 'Неизвестное устройство'}</div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                                  {dev.ip && <span className="faint mono" style={{ fontSize: 11 }}>IP: {dev.ip}</span>}
                                  {dev.userAgent && <span className="faint" style={{ fontSize: 11 }}>{dev.userAgent.slice(0, 60)}</span>}
                                  {dev.createdAt && <span className="faint" style={{ fontSize: 11 }}>Добавлено: {fmtDate(dev.createdAt)}</span>}
                                  {dev.updatedAt && <span className="faint" style={{ fontSize: 11 }}>Обновлено: {fmtDate(dev.updatedAt)}</span>}
                                  {devId && <span className="faint mono" style={{ fontSize: 11 }}>HWID: {devId}</span>}
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
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>ID</th><th>Тип</th><th>Сумма</th><th>Статус</th><th>Метод</th><th>Описание</th><th>Дата</th></tr></thead>
            <tbody>
              {user.transactions.length === 0
                ? <tr className="empty-row"><td colSpan={7}>Нет операций</td></tr>
                : user.transactions.map(tx => (
                  <tr key={tx.id}>
                    <td className="muted mono">#{tx.id}</td>
                    <td className="faint" style={{ fontSize: 12 }}>{tx.type}</td>
                    <td style={{ fontWeight: 600, color: tx.amount > 0 ? 'var(--text)' : 'var(--muted)' }}>{tx.amount > 0 ? '+' : ''}{tx.amount} ₽</td>
                    <td><span className={`badge ${tx.status === 'Success' ? 'solid' : tx.status === 'Pending' ? 'mute' : 'danger'}`}>{tx.status}</span></td>
                    <td className="muted">{tx.payment_provider || tx.payment_method || '—'}</td>
                    <td className="faint" style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.description || '—'}</td>
                    <td className="faint">{fmtDateShort(tx.created_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── REFERRALS TAB ── */}
      {activeTab === 'referrals' && (
        <ReferralsList userId={user.id} onToast={onToast} />
      )}

      {/* ── MODALS ── */}
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'Trial' | 'Active' | 'Banned'>('all');
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
          balance: u.balance ?? 0, status: u.status || 'Trial',
          registration_date: u.registration_date,
          is_banned: u.is_banned || 0, in_blacklist: !!u.in_blacklist,
          partner_balance: u.partner_balance ?? 0, partner_rate: u.partner_rate ?? 20,
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
  const filterLabels = { all: 'Все', Trial: 'Триал', Active: 'Активные', Banned: 'Забл.' };

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
              {(['all', 'Trial', 'Active', 'Banned'] as const).map(f => (
                <button key={f} className="menu-item" onClick={() => { setStatusFilter(f); setShowFilter(false); }}>{filterLabels[f]}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Пользователь</th><th>Статус</th><th>Реф. баланс</th><th>Процент</th><th>Регистрация</th></tr></thead>
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
                : { cls: 'line', label: 'Истёк' };
              return (
                <tr key={u.id} className="click" onClick={() => onOpenUser(u.id)}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{u.username ? `@${u.username}` : u.full_name || u.email || (u.telegram_id != null ? `id${u.telegram_id}` : `#${u.id}`)}</div>
                    <div className="faint mono" style={{ fontSize: 11 }}>{u.email || (u.telegram_id != null ? `tg:${u.telegram_id}` : `id:${u.id}`)}</div>
                  </td>
                  <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                  <td className="mono">{fmtM(u.partner_balance)}</td>
                  <td className="muted">{u.partner_rate}%</td>
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

// ─── SETTINGS PAGE ────────────────────────────────────────────────
const SettingsPage: React.FC<{ onToast: (t: string, m?: string, ty?: ToastType) => void; onLogout: () => void }> = ({ onToast, onLogout }) => {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/panel/settings').then(d => { if (d) setSettings(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/panel/settings', { method: 'PUT', body: JSON.stringify(settings) });
      onToast('Настройки сохранены', undefined, 'success');
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
    setSaving(false);
  };

  const changePassword = async () => {
    const newPwd = prompt('Новый пароль (минимум 8 символов):');
    if (!newPwd || newPwd.length < 8) return;
    try {
      await apiFetch('/panel/auth/change-password', { method: 'POST', body: JSON.stringify({ new_password: newPwd }) });
      onToast('Пароль изменён', undefined, 'success');
    } catch (e: any) { onToast('Ошибка', e.message, 'error'); }
  };

  if (loading) return <div className="flex items-center justify-center" style={{ height: 200 }}><Spinner size={28} /></div>;

  return (
    <div className="flex flex-col gap-6 rise">
      <div><div className="h-page">Настройки</div><div className="sub mt-1">Конфигурация системы</div></div>
      {settings && (
        <div className="card" style={{ padding: 24 }}>
          <h3 className="h-sec mb-4">Системные параметры</h3>
          <div className="flex flex-col gap-4">
            {Object.entries(settings).map(([k, v]) => typeof v !== 'object' && (
              <div key={k}>
                <label className="field-label">{k}</label>
                <input className="input" value={String(v ?? '')} onChange={e => setSettings((prev: any) => ({ ...prev, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-5">
            <button className="btn solid" disabled={saving} onClick={save}>{saving ? <Spinner size={14} /> : <><Save size={14} /> Сохранить</>}</button>
          </div>
        </div>
      )}
      <div className="card" style={{ padding: 24 }}>
        <h3 className="h-sec mb-4">Безопасность</h3>
        <div className="flex gap-3">
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
  const [openUserId, setOpenUserId] = useState<number | null>(null);  // internal users.id
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Finance state (kept at top level to share between FinancePage and modal)
  const [transactions, setTransactions] = useState<any[]>([]);
  const [selectedTx, setSelectedTx] = useState<any | null>(null);

  // Revenue total for topbar
  const [totalRevenue, setTotalRevenue] = useState(0);

  useEffect(() => {
    apiFetch('/panel/stats/summary').then(d => { if (d) setTotalRevenue(d.monthly_revenue || 0); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (activePage === 'Финансы') {
      apiFetch('/panel/transactions').then(d => {
        const raw = Array.isArray(d) ? d : (d?.transactions || []);
        setTransactions(raw.map((tx: any) => ({
          id: tx.id, user: tx.username || tx.telegram_id || '—',
          amount: tx.amount || 0, type: tx.amount > 0 ? 'income' : 'expense',
          status: tx.status || '—', method: tx.payment_method || tx.payment_provider || '—',
          date: tx.created_at ? new Date(tx.created_at).toLocaleDateString('ru-RU') : '—',
          hash: tx.hash || '',
        })));
      }).catch(console.error);
    }
  }, [activePage]);

  // ?uid=internal_user_id | ?tg=telegram_id (never ambiguous ?user=)
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
    { group: 'Данные', items: [{ name: 'Пользователи', icon: Users }, { name: 'Ключи', icon: Key }] },
    { group: 'Маркетинг', items: [{ name: 'Рассылка', icon: Mail }, { name: 'Промокоды', icon: Gift }] },
    { group: 'Система', items: [{ name: 'Настройки', icon: Settings }] },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <ToastContainer toasts={toasts} remove={removeToast} />

      {/* Sidebar */}
      <aside style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: 232, zIndex: 50,
        background: 'var(--surface)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }} className={isMobileOpen ? '' : 'hidden md:flex'}>
        <div style={{ padding: '22px 16px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>1FEDERAL</div>
          <div className="sub" style={{ fontSize: 11, marginTop: 2 }}>Admin Panel</div>
        </div>
        <nav style={{ padding: '10px 8px', flex: 1 }}>
          {nav.map(section => (
            <div key={section.group} style={{ marginBottom: 18 }}>
              <div className="nav-group" style={{ marginBottom: 4 }}>{section.group}</div>
              {section.items.map(item => (
                <button key={item.name}
                  className={`nav-item ${activePage === item.name && !openUserId ? 'on' : ''}`}
                  onClick={() => { setActivePage(item.name); closeUser(); setIsMobileOpen(false); }}>
                  <item.icon size={15} className={activePage === item.name && !openUserId ? '' : 'faint'} />
                  {item.name}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ padding: '10px 8px', borderTop: '1px solid var(--border)' }}>
          <button className="btn ghost block" onClick={onLogout} style={{ justifyContent: 'flex-start', gap: 10 }}>
            <Lock size={14} className="faint" /> Выйти
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40 }} onClick={() => setIsMobileOpen(false)} />
      )}

      {/* Main */}
      <main style={{ flex: 1, marginLeft: 0 }} className="md:ml-[232px]">
        {/* Topbar */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 30,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
          padding: '9px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div className="flex items-center gap-3">
            <button className="icon-btn md:hidden" onClick={() => setIsMobileOpen(!isMobileOpen)}>
              {isMobileOpen ? <X size={17} /> : <Menu size={17} />}
            </button>
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {openUserId ? `Пользователь #${openUserId}` : activePage}
            </span>
          </div>
          <div className="inset" style={{ padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarSign size={13} className="faint" />
            <span style={{ fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {totalRevenue.toLocaleString('ru-RU')} ₽
            </span>
          </div>
        </div>

        {/* Page */}
        <div style={{ padding: 24 }}>
          {/* User detail overrides page content */}
          {openUserId && activePage === 'Пользователи' ? (
            <UserDetailPage
              userId={openUserId}
              onBack={() => closeUser()}
              onToast={addToast}
            />
          ) : (
            <>
              {activePage === 'Главная' && <Dashboard />}
              {activePage === 'Финансы' && <><FinancePage transactions={transactions} onSelect={setSelectedTx} />{selectedTx && <TransactionModal tx={selectedTx} onClose={() => setSelectedTx(null)} />}</>}
              {activePage === 'Статистика' && <StatisticsPage />}
              {activePage === 'Пользователи' && <UsersPage onOpenUser={openUser} />}
              {activePage === 'Ключи' && <KeysPage onToast={addToast} />}
              {activePage === 'Рассылка' && <MailingPage onToast={addToast} />}
              {activePage === 'Промокоды' && <PromocodesPage onToast={addToast} />}
              {activePage === 'Настройки' && <SettingsPage onToast={addToast} onLogout={onLogout} />}
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
