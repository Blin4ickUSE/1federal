import React, { useState, useEffect, useRef } from 'react';
import {
  Home, DollarSign, BarChart2, Users, Key, Mail, Tag, Percent,
  MessageSquare, Server, FileText, Globe, Settings, Menu, X, CheckCircle,
  AlertCircle, TrendingUp, CreditCard, Search, Filter, ArrowUpRight,
  ArrowDownLeft, Activity, Calendar, Download, Loader, RefreshCcw,
  Hash, Monitor, PieChart, Ban, UserX, UserCheck, Trophy, UserPlus, UserMinus,
  Clock, XCircle, Edit2, Copy, Shield, Smartphone, Zap, Wifi, Database,
  Bell, CheckSquare, Square, ChevronRight, Wallet, Bitcoin, Plus,
  Terminal, Lock, Briefcase, Star, TrendingDown, Send, Image as ImageIcon, MousePointer,
  Gift, Layers, Flame, ShoppingBag, Paperclip, MoreVertical, MessageCircle, User as UserIcon,
  Moon, Dices, ToggleLeft, ToggleRight, FileCheck, FileText as FileTextIcon,
  Trash2, ChevronDown, Save, AlertTriangle, Cloud, Link, RefreshCw
} from 'lucide-react';

declare const importMeta: any | undefined;

const rawEnv: any =
  (typeof importMeta !== 'undefined' && importMeta.env) ||
  (typeof (window as any) !== 'undefined' && (window as any).__ENV__) ||
  {};

const API_BASE_URL: string = rawEnv.VITE_API_URL || rawEnv.REACT_APP_API_URL || '/api';
const BOT_USERNAME: string = rawEnv.VITE_BOT_USERNAME || rawEnv.REACT_APP_BOT_USERNAME || 'onefederalbot';

function getPanelSecret(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('panel_secret') || '';
  }
  return '';
}

function setPanelSecret(secret: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('panel_secret', secret);
  }
}

function clearPanelSecret(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('panel_secret');
  }
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `/api${cleanPath}`;

  const headers: any = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (cleanPath.startsWith('/panel')) {
    const secret = getPanelSecret();
    if (secret) {
      headers['Authorization'] = `Bearer ${secret}`;
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {

    if (res.status === 401) {
      clearPanelSecret();
      window.location.reload();
    }
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

type ToastType = 'success' | 'error' | 'info';
type TransactionType = 'income' | 'expense';
type UserStatus = 'Active' | 'Trial' | 'Banned' | 'Expired';
type KeyStatus = 'Active' | 'Expired' | 'Banned';

interface Toast {
  id: number;
  title: string;
  message?: string;
  type: ToastType;
}

interface Transaction {
  id: number;
  user: string;
  amount: number;
  type: TransactionType;
  status: string;
  method: string;
  date: string;
  hash: string;
}

interface AutoPayDetails {
  sbp: boolean;
  card: boolean;
  crypto: boolean;
}

interface User {
  id: number;
  telegramId: number;
  username: string;
  name: string;
  balance: number;
  status: UserStatus;
  traffic: number;
  maxTraffic: number;
  devices: number;
  maxDevices: number;
  regDate: string;
  paidUntil: string;
  autoPayDetails: AutoPayDetails;
  refLink: string;
  refCode: string;
  squads: string[];
  firstDeposit: boolean;
  wasPaid: boolean;
  isPartner: boolean;
  partnerBalance: number;
  partnerRate: number;
  referrals: number;
  totalEarned: number;
  inBlacklist: boolean;
  referralWithdrawBlocked: boolean;
}

const mapApiUser = (u: any): User => ({
  id: u.id,
  telegramId: u.telegram_id,
  username: u.username ? (u.username.startsWith('@') ? u.username : `@${u.username}`) : `id${u.telegram_id}`,
  name: u.full_name || '',
  balance: u.balance ?? 0,
  status: (u.in_blacklist || u.is_banned) ? 'Banned' : ((u.status as UserStatus) || 'Trial'),
  traffic: 0,
  maxTraffic: 100,
  devices: 0,
  maxDevices: 1,
  regDate: u.registration_date ? new Date(u.registration_date).toLocaleDateString('ru-RU') : '',
  paidUntil: u.paid_until ? new Date(u.paid_until).toLocaleDateString('ru-RU') : '—',
  autoPayDetails: { sbp: false, card: false, crypto: false },
  refLink: `https://t.me/${BOT_USERNAME}?start=ref=${u.telegram_id}`,
  refCode: u.referral_code || '',
  squads: [],
  firstDeposit: false,
  wasPaid: false,
  isPartner: !!u.is_partner,
  partnerBalance: u.partner_balance ?? 0,
  partnerRate: u.partner_rate ?? 20,
  referrals: 0,
  totalEarned: u.total_earned ?? 0,
  inBlacklist: !!u.in_blacklist,
  referralWithdrawBlocked: !!u.referral_withdraw_blocked,
});

const USERS_PAGE_SIZE = 50;

interface KeyItem {
  id: number;
  key: string;
  user: string;
  status: KeyStatus;
  expiry: number;
  trafficUsed: number;
  trafficLimit: number;
  devicesUsed: number;
  devicesLimit: number;
  server: string;
}

interface Promo {
  id: number;
  code: string;
  type: 'balance' | 'discount' | 'ref_boost' | 'subscription';
  value: string;
  uses: number;
  limit: number;
  expires: string;
}

interface Plan {
  id: number;
  name: string;
  price: number;
  oldPrice?: number;
  duration: number;
  isHit: boolean;
  description: string;
}

interface ToastContainerProps {
  toasts: Toast[];
  removeToast: (id: number) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, removeToast }) => {
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border
            transform transition-all duration-300 animate-in slide-in-from-right-full fade-in
            ${toast.type === 'success' ? 'bg-gray-900 border-green-500/30 text-green-400' : 'bg-gray-900 border-red-500/30 text-red-400'}
          `}
          role="alert"
        >
          {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <div>
            <h4 className="font-bold text-sm text-gray-100">{toast.title}</h4>
            {toast.message && <p className="text-xs text-gray-400 mt-0.5">{toast.message}</p>}
          </div>
          <button onClick={() => removeToast(toast.id)} className="ml-2 text-gray-500 hover:text-white">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'indigo' | 'orange' | 'purple' | 'red' | 'gray';
  subValue?: string;
  className?: string;
}

function StatCard({ title, value, change, icon: Icon, color, subValue, className }: StatCardProps) {
  const isPositive = change && (change.startsWith('+') || !change.startsWith('-'));
  const colors = {
    blue: "bg-blue-500 text-blue-500",
    green: "bg-green-500 text-green-500",
    indigo: "bg-indigo-500 text-indigo-500",
    orange: "bg-orange-500 text-orange-500",
    purple: "bg-purple-500 text-purple-500",
    red: "bg-red-500 text-red-500",
    gray: "bg-gray-500 text-gray-500"
  };
  const bgClass = colors[color]?.split(' ')[0] + '/10';
  const textClass = colors[color]?.split(' ')[1];

  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition-all duration-300 group h-full ${className}`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-gray-400 text-sm font-medium">{title}</p>
          <div className="flex items-baseline mt-1">
             <h3 className="text-2xl font-bold text-white group-hover:translate-x-1 transition-transform">{value}</h3>
             {subValue && <span className="ml-2 text-sm text-gray-500">{subValue}</span>}
          </div>
        </div>
        <div className={`p-3 rounded-xl ${bgClass}`}>
          <Icon size={22} className={textClass} />
        </div>
      </div>
      {change && (
        <div className="flex items-center text-xs">
          <span className={`font-medium px-2 py-0.5 rounded ${isPositive ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
            {change}
          </span>
          <span className="text-gray-500 ml-2">за период</span>
        </div>
      )}
    </div>
  );
}

interface SmoothAreaChartProps {
    color: string;
    data: number[];
    label: string;
    height?: number;
    id?: string;
    labels?: string[];
}

const SmoothAreaChart: React.FC<SmoothAreaChartProps> = ({ color, data, label, height = 200, id, labels = [] }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const uniqueId = id || Math.random().toString(36).substr(2, 9);

  if (!data || data.length === 0) return <div className="h-48 flex items-center justify-center text-gray-500">Нет данных</div>;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const svgWidth = 1000;
  const svgHeight = 400;

  const getPathData = (data: number[], width: number, height: number, max: number, min: number) => {
    const points = data.map((val, index) => {
      const x = (index / (data.length - 1)) * width;
      const normalizedY = ((val - min) / (max - min || 1));
      const y = height - (normalizedY * (height * 0.7) + (height * 0.15));
      return [x, y];
    });

    const line = (pointA: number[], pointB: number[]) => {
      const lengthX = pointB[0] - pointA[0];
      const lengthY = pointB[1] - pointA[1];
      return { length: Math.sqrt(Math.pow(lengthX, 2) + Math.pow(lengthY, 2)), angle: Math.atan2(lengthY, lengthX) };
    };

    const controlPoint = (current: number[], previous: number[], next: number[], reverse?: boolean) => {
      const p = previous || current; const n = next || current; const smoothing = 0.2;
      const o = line(p, n); const angle = o.angle + (reverse ? Math.PI : 0); const length = o.length * smoothing;
      const x = current[0] + Math.cos(angle) * length; const y = current[1] + Math.sin(angle) * length;
      return [x, y];
    };

    const bezierCommand = (point: number[], i: number, a: number[][]) => {
      const [cpsX, cpsY] = controlPoint(a[i - 1], a[i - 2], point);
      const [cpeX, cpeY] = controlPoint(point, a[i - 1], a[i + 1], true);
      return `C ${cpsX},${cpsY} ${cpeX},${cpeY} ${point[0]},${point[1]}`;
    };

    return points.reduce((acc, point, i, a) => {
      if (i === 0) return `M ${point[0]},${point[1]}`;
      return `${acc} ${bezierCommand(point, i, a)}`;
    }, "");
  };

  const pathD = getPathData(data, svgWidth, svgHeight, max, min);
  const fillPathD = `${pathD} L ${svgWidth},${svgHeight} L 0,${svgHeight} Z`;
  const points = data.map((val, index) => ({ x: (index / (data.length - 1)) * 100, val }));

  return (
    <div className={`w-full relative group select-none`} style={{ height: `${height}px` }} onMouseLeave={() => setActiveIndex(null)}>
      {activeIndex !== null && (
        <div
          className="absolute -top-10 transform -translate-x-1/2 bg-gray-800 text-white text-xs py-1.5 px-3 rounded-lg shadow-xl border border-gray-700 whitespace-nowrap z-20 pointer-events-none transition-all duration-75"
          style={{ left: `${points[activeIndex].x}%` }}
        >
            {labels[activeIndex] && <span className="text-gray-400 mr-2">{labels[activeIndex]}</span>}
            <span className="font-bold">{points[activeIndex].val.toLocaleString('ru-RU')}</span>
            <span className="text-gray-400 ml-1">{label}</span>
        </div>
      )}

      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
        <defs>
          <linearGradient id={`grad-${uniqueId}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillPathD} fill={`url(#grad-${uniqueId})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="absolute inset-0 flex items-stretch">
         {data.map((_, i) => (
             <div
                key={i}
                className="flex-1 hover:bg-white/5 transition-colors cursor-crosshair relative group/bar"
                onMouseEnter={() => setActiveIndex(i)}
             >
                 {activeIndex === i && (
                     <div className="absolute w-3 h-3 rounded-full border-2 border-white transform -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-lg"
                        style={{
                            backgroundColor: color,
                            left: '50%',
                            top: `${100 - (((data[i] - min) / (max - min || 1)) * 70 + 15)}%`
                        }}
                     />
                 )}
             </div>
         ))}
      </div>
    </div>
  );
};

const DualLineChart: React.FC<{ labels: string[]; users: number[]; keys: number[]; height?: number }> = ({ labels, users, keys, height = 260 }) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const usersSafe = users.length ? users : [0];
  const keysSafe = keys.length ? keys : [0];
  const len = Math.max(usersSafe.length, keysSafe.length);
  if (!len) return <div className="h-48 flex items-center justify-center text-gray-500">Нет данных</div>;

  const dataUsers = Array.from({ length: len }).map((_, i) => usersSafe[i] ?? usersSafe[usersSafe.length - 1] ?? 0);
  const dataKeys = Array.from({ length: len }).map((_, i) => keysSafe[i] ?? keysSafe[keysSafe.length - 1] ?? 0);
  const yMax = Math.max(1, ...dataUsers, ...dataKeys);
  const yMin = 0;
  const idx = hoverIndex ?? len - 1;

  const toX = (i: number) => (i / Math.max(1, len - 1)) * 100;
  const toY = (v: number) => {
    const normalized = (v - yMin) / Math.max(1, yMax - yMin);
    return 88 - normalized * 74;
  };
  const linePoints = (arr: number[]) => arr.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
  const hoverX = toX(idx);
  const hoverUsersY = toY(dataUsers[idx]);
  const hoverKeysY = toY(dataKeys[idx]);

  const fmt = (n: number) => n.toLocaleString('ru-RU');
  return (
    <div className="w-full relative select-none" style={{ height }} onMouseLeave={() => setHoverIndex(null)}>
      <div className="absolute right-3 top-3 z-20 flex items-center gap-4 text-xs">
        <span className="flex items-center text-gray-300"><span className="w-2.5 h-2.5 rounded-full bg-orange-400 mr-1.5" />Юзеры</span>
        <span className="flex items-center text-gray-300"><span className="w-2.5 h-2.5 rounded-full bg-gray-200 mr-1.5" />Ключи</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full rounded-xl bg-gradient-to-b from-gray-900/70 to-gray-950/40 border border-gray-800">
        {[14, 32, 50, 68, 86].map((y) => (
          <line key={y} x1="4" y1={y} x2="98" y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="0.35" />
        ))}
        {[0, 1, 2, 3, 4, 5].map((step) => (
          <line key={`x-${step}`} x1={4 + step * 18.8} y1="14" x2={4 + step * 18.8} y2="86" stroke="rgba(255,255,255,0.04)" strokeWidth="0.25" />
        ))}

        <polyline fill="none" stroke="#fb923c" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" points={linePoints(dataUsers)} />
        <polyline fill="none" stroke="#e5e7eb" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" points={linePoints(dataKeys)} />

        <line x1={hoverX} y1="14" x2={hoverX} y2="86" stroke="rgba(251,146,60,0.45)" strokeWidth="0.45" />
        <circle cx={hoverX} cy={hoverUsersY} r="0.9" fill="#fb923c" />
        <circle cx={hoverX} cy={hoverKeysY} r="0.9" fill="#e5e7eb" />
      </svg>

      <div className="absolute left-0 right-0 top-0 bottom-8 flex px-[4%]">
        {Array.from({ length: len }).map((_, i) => (
          <div key={i} className="flex-1 h-full" onMouseEnter={() => setHoverIndex(i)} />
        ))}
      </div>

      <div
        className="absolute z-30 bg-gray-900/95 border border-gray-700 rounded-xl px-3 py-2 text-sm shadow-2xl pointer-events-none transition-all duration-100"
        style={{ left: `calc(${hoverX}% - 68px)`, top: '6px' }}
      >
        <div className="text-gray-300 text-xs mb-1">{labels[idx] || ''}</div>
        <div className="flex justify-between gap-5"><span className="text-gray-300">Юзеры</span><span className="text-orange-400 font-semibold">{fmt(dataUsers[idx])}</span></div>
        <div className="flex justify-between gap-5"><span className="text-gray-300">Ключи</span><span className="text-gray-100 font-semibold">{fmt(dataKeys[idx])}</span></div>
      </div>

      <div className="mt-2 grid grid-cols-6 text-[11px] text-gray-500 px-1">
        {[0, 1, 2, 3, 4, 5].map((step) => {
          const i = Math.min(len - 1, Math.round((step / 5) * (len - 1)));
          return <span key={step} className={step === 0 ? 'text-left' : step === 5 ? 'text-right' : 'text-center'}>{labels[i] || ''}</span>;
        })}
      </div>
    </div>
  );
};

interface PieChartItem {
    label: string;
    value: number;
    percent?: number;
    userCount?: number;
    purchaseCount?: number;
}

interface PieChartProps {
    data: PieChartItem[];
    colors: string[];
    centerLabel?: string;
    centerSubLabel?: string;
    emptyMessage?: string;
}

const PieChartComponent: React.FC<PieChartProps> = ({ data, colors, centerLabel, centerSubLabel, emptyMessage }) => {
  const sliceData = data.filter((item) => item.value > 0);
  const total = sliceData.reduce((acc, item) => acc + item.value, 0);
  let cumulativePercent = 0;

  const getCoordinatesForPercent = (percent: number) => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  };

  if (total <= 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        {emptyMessage || 'Нет данных'}
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row items-center justify-center gap-8">
      <div className="relative w-44 h-44 shrink-0">
        <svg viewBox="-1 -1 2 2" className="transform -rotate-90 w-full h-full">
          {sliceData.map((item, index) => {
            const startPercent = cumulativePercent;
            const slicePercent = item.value / total;
            cumulativePercent += slicePercent;
            const [startX, startY] = getCoordinatesForPercent(startPercent);
            const [endX, endY] = getCoordinatesForPercent(cumulativePercent);
            const largeArcFlag = slicePercent > 0.5 ? 1 : 0;
            const pathData = `M 0 0 L ${startX} ${startY} A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY} Z`;
            const colorIdx = data.indexOf(item);

            return (
              <path key={index} d={pathData} fill={colors[colorIdx % colors.length]} className="hover:opacity-80 transition-opacity cursor-pointer" />
            );
          })}
          <circle cx="0" cy="0" r="0.55" fill="#111827" />
        </svg>
        {centerLabel && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-2">
            <span className="text-xl font-bold text-white leading-tight">{centerLabel}</span>
            {centerSubLabel && <span className="text-[10px] text-gray-500 mt-0.5">{centerSubLabel}</span>}
          </div>
        )}
      </div>
      <div className="space-y-2 w-full max-w-sm">
        {data.map((item, index) => {
          const pct = item.percent != null
            ? item.percent
            : (total > 0 ? Math.round((item.value / total) * 100) : 0);
          const users = item.userCount ?? 0;
          const purchases = item.purchaseCount ?? item.value;
          return (
            <div key={index} className="flex items-start gap-2">
              <div className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ backgroundColor: colors[index % colors.length] }}></div>
              <div className="min-w-0">
                <span className="text-gray-300 text-sm font-medium">{item.label}</span>
                <div className="text-gray-500 text-xs mt-0.5">
                  {pct}% · {users.toLocaleString('ru-RU')} польз. · {purchases.toLocaleString('ru-RU')} покупок
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface UserActionModalProps {
    type: string;
    onClose: () => void;
    onConfirm: (value: string, notify: boolean) => void;
    initialValue?: string;
}

const UserActionModal: React.FC<UserActionModalProps> = ({ type, onClose, onConfirm, initialValue = '' }) => {
  const [value, setValue] = useState(initialValue);
  const [notify, setNotify] = useState(true);

  type ActionConfig = {
      title: string;
      label: string;
      icon: React.ElementType;
      color: string;
      type: string;
  };

  const config: ActionConfig = ({
      'SET_REFERRAL_BALANCE': { title: 'Изменить реф. баланс', label: 'Новая сумма (₽)', icon: DollarSign, color: 'text-emerald-400', type: 'number' },
      'ADD_REFERRAL_BALANCE': { title: 'Начислить реф. баланс', label: 'Сумма (₽)', icon: ArrowUpRight, color: 'text-green-400', type: 'number' },
      'SUB_REFERRAL_BALANCE': { title: 'Списать реф. баланс', label: 'Сумма (₽)', icon: ArrowDownLeft, color: 'text-red-400', type: 'number' },
      'EXTEND_SUB': { title: 'Продлить подписку', label: 'Количество дней', icon: Clock, color: 'text-blue-400', type: 'number' },
      'REDUCE_SUB': { title: 'Уменьшить срок', label: 'Количество дней', icon: Clock, color: 'text-orange-400', type: 'number' },
      'SET_TRAFFIC': { title: 'Лимит трафика', label: 'Макс. трафик (GB)', icon: Database, color: 'text-purple-400', type: 'number' },
      'SET_DEVICES': { title: 'Лимит устройств', label: 'Кол-во устройств', icon: Smartphone, color: 'text-indigo-400', type: 'number' },
      'BAN': { title: 'Заблокировать', label: 'Причина бана', icon: Ban, color: 'text-red-400', type: 'text' },
      'UNBAN': { title: 'Разблокировать', label: '', icon: CheckCircle, color: 'text-green-400', type: 'text' },
      'MASS_ADD_DAYS': { title: 'Всем добавить дни', label: 'Количество дней', icon: Calendar, color: 'text-blue-500', type: 'number' },
      'MASS_BAN': { title: 'Забанить всех', label: 'Причина', icon: Ban, color: 'text-red-500', type: 'text' },
      'MASS_UNBAN': { title: 'Разбанить всех', label: '', icon: CheckCircle, color: 'text-green-500', type: 'text' },
      'MASS_RESET_TRIAL': { title: 'Сбросить пробный период', label: '', icon: RefreshCw, color: 'text-yellow-500', type: 'text' },
      'MASS_DELETE_KEYS': { title: 'Удалить все ключи', label: '', icon: Trash2, color: 'text-red-500', type: 'text' },
      'MASS_SET_PARTNER': { title: 'Сделать партнерами', label: 'Процент реферала', icon: UserPlus, color: 'text-indigo-500', type: 'number' },
      'MASS_REMOVE_PARTNER': { title: 'Убрать партнерство', label: '', icon: UserMinus, color: 'text-gray-500', type: 'text' },
  } as Record<string, ActionConfig>)[type] || { title: 'Действие', label: 'Значение', icon: Settings, color: 'text-white', type: 'text' };

  return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-6"><div className={`p-2 bg-gray-800 rounded-lg ${config.color}`}><config.icon size={24} /></div><h3 className="text-xl font-bold text-white">{config.title}</h3></div>
              <div className="space-y-4">
                  <div>
                      <label className="text-xs text-gray-500 block mb-1.5">{config.label}</label>
                      <input
                        type={config.type}
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 text-white text-lg rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                        placeholder="0"
                        autoFocus
                        min="0"
                      />
                  </div>
                  <label className="flex items-center cursor-pointer group bg-gray-950/50 p-3 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors">
                      <div className="relative"><input type="checkbox" checked={notify} onChange={() => setNotify(!notify)} className="sr-only" /><div className={`w-10 h-6 bg-gray-700 rounded-full shadow-inner transition-colors ${notify ? 'bg-blue-600' : ''}`}></div><div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${notify ? 'translate-x-4' : ''}`}></div></div><div className="ml-3"><div className="text-sm text-gray-200 font-medium">Уведомить пользователя</div><div className="text-xs text-gray-500">Отправить сообщение в бот</div></div>
                  </label>
                  <div className="flex gap-3 pt-2">
                      <button onClick={onClose} className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-medium transition-colors">Отмена</button>
                      <button onClick={() => onConfirm(value, notify)} className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-colors">Применить</button>
                  </div>
              </div>
          </div>
      </div>
  );
};

interface KeyEditModalProps {
    keyItem: KeyItem;
    onClose: () => void;
    onSave: (id: number, expiry: number) => void;
    onDelete: (id: number) => void;
    onBlock?: (id: number, blocked: boolean) => void;
}

const KeyEditModal: React.FC<KeyEditModalProps> = ({ keyItem, onClose, onSave, onDelete, onBlock }) => {
    const [expiryDays, setExpiryDays] = useState(keyItem.expiry);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isBlocked, setIsBlocked] = useState(keyItem.status === 'Blocked' || keyItem.status === 'blocked');
    const [blockLoading, setBlockLoading] = useState(false);

    const handleToggleBlock = async () => {
        setBlockLoading(true);
        try {
            const newStatus = !isBlocked;
            await fetch(`/api/panel/keys/${keyItem.id}/block`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('panel_token') || localStorage.getItem('panel_session')}` },
                body: JSON.stringify({ blocked: newStatus })
            });
            setIsBlocked(newStatus);
            if (onBlock) onBlock(keyItem.id, newStatus);
        } catch (e) {
            console.error('Failed to toggle block', e);
        } finally {
            setBlockLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-start mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center"><Key size={22} className="mr-2 text-blue-500"/> Редактирование ключа</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={20}/></button>
                </div>

                {!confirmDelete ? (
                    <div className="space-y-6">
                        <div className="p-3 bg-gray-950 rounded-xl border border-gray-800 font-mono text-xs text-gray-400 break-all select-all">
                            {keyItem.key}
                        </div>

                        {}
                        <div className="p-4 bg-gray-950 rounded-xl border border-gray-800">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">Использовано трафика</span>
                                <span className="text-sm font-mono text-white">
                                    {(keyItem.trafficUsed / (1024**3)).toFixed(2)} / {keyItem.trafficLimit > 0 ? (keyItem.trafficLimit / (1024**3)).toFixed(0) : '∞'} ГБ
                                </span>
                            </div>
                            <div className="w-full bg-gray-800 rounded-full h-2">
                                <div
                                    className={`h-2 rounded-full transition-all ${
                                        keyItem.trafficLimit > 0 && keyItem.trafficUsed/keyItem.trafficLimit > 0.9 ? 'bg-red-500' :
                                        keyItem.trafficLimit > 0 && keyItem.trafficUsed/keyItem.trafficLimit > 0.7 ? 'bg-yellow-500' : 'bg-blue-500'
                                    }`}
                                    style={{ width: `${keyItem.trafficLimit > 0 ? Math.min(100, (keyItem.trafficUsed/keyItem.trafficLimit)*100) : 0}%` }}
                                ></div>
                            </div>
                            {keyItem.trafficLimit > 0 && keyItem.trafficUsed/keyItem.trafficLimit > 0.9 && (
                                <div className="text-xs text-red-400 mt-2 flex items-center">
                                    <AlertTriangle size={12} className="mr-1" />
                                    Трафик почти исчерпан
                                </div>
                            )}
                        </div>

                        {}
                        <div className="flex items-center justify-between p-3 bg-gray-950 rounded-xl border border-gray-800">
                            <div>
                                <div className="text-sm text-white font-medium">Блокировка ключа</div>
                                <div className="text-xs text-gray-500">
                                    {isBlocked ? 'Ключ заблокирован вручную' : 'Ключ активен'}
                                </div>
                            </div>
                            <button
                                onClick={handleToggleBlock}
                                disabled={blockLoading}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    isBlocked
                                        ? 'bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-600/20'
                                        : 'bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20'
                                } ${blockLoading ? 'opacity-50' : ''}`}
                            >
                                {blockLoading ? '...' : (isBlocked ? 'Разблокировать' : 'Заблокировать')}
                            </button>
                        </div>

                        <div>
                            <label className="text-sm text-gray-400 block mb-2">Осталось дней</label>
                            <div className="flex gap-2">
                                <button onClick={() => setExpiryDays(Math.max(0, Number(expiryDays) - 1))} className="p-3 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors"><ArrowDownLeft size={18}/></button>
                                <input
                                    type="number"
                                    value={expiryDays}
                                    onChange={(e) => setExpiryDays(parseInt(e.target.value) || 0)}
                                    className="flex-1 bg-gray-950 border border-gray-700 text-center text-white text-lg rounded-xl focus:border-blue-500 outline-none font-mono"
                                />
                                <button onClick={() => setExpiryDays(Number(expiryDays) + 1)} className="p-3 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors"><ArrowUpRight size={18}/></button>
                            </div>
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button onClick={() => setConfirmDelete(true)} className="flex-1 py-3 bg-red-600/10 hover:bg-red-600/20 text-red-500 border border-red-600/20 rounded-xl font-medium transition-colors flex items-center justify-center">
                                <Trash2 size={18} className="mr-2"/> Удалить
                            </button>
                            <button onClick={() => onSave(keyItem.id, expiryDays)} className="flex-[2] py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-colors flex items-center justify-center">
                                <Save size={18} className="mr-2"/> Сохранить
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4 text-center py-4">
                        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto text-red-500 mb-2">
                            <AlertTriangle size={32} />
                        </div>
                        <h4 className="text-lg font-bold text-white">Удалить этот ключ?</h4>
                        <p className="text-gray-400 text-sm">Это действие необратимо. Пользователь потеряет доступ.</p>
                        <div className="flex gap-3 pt-4">
                             <button onClick={() => setConfirmDelete(false)} className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-medium">Отмена</button>
                             <button onClick={() => onDelete(keyItem.id)} className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold shadow-lg shadow-red-900/20">Да, удалить</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

interface TransactionModalProps {
    transaction: Transaction;
    onClose: () => void;
}

const TransactionModal: React.FC<TransactionModalProps> = ({ transaction, onClose }) => {

  if (!transaction) return null;
  const isIncome = transaction.type === 'income';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"><X size={20} /></button>

        <div className="text-center mb-6">
            <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-4 ${isIncome ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                {isIncome ? <ArrowUpRight size={32} /> : <ArrowDownLeft size={32} />}
            </div>
            <h3 className="text-xl font-bold text-white">{isIncome ? 'Пополнение баланса' : 'Списание средств'}</h3>
            <p className="text-gray-400 text-sm mt-1">{transaction.date}</p>
        </div>

        <div className="space-y-4 mb-8">
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><Hash size={14} className="mr-2"/> ID</span><span className="text-white font-mono">#{transaction.id}</span></div>
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><Users size={14} className="mr-2"/> Пользователь</span><span className="text-blue-400">{transaction.user}</span></div>
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><DollarSign size={14} className="mr-2"/> Сумма</span><span className={`font-bold ${isIncome ? 'text-green-400' : 'text-red-400'}`}>{transaction.amount} ₽</span></div>
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><CreditCard size={14} className="mr-2"/> Метод</span><span className="text-white">{transaction.method}</span></div>
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><FileText size={14} className="mr-2"/> Hash</span><span className="text-xs text-gray-500 font-mono">{transaction.hash}</span></div>
        </div>

        <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-colors font-medium">Закрыть</button>
        </div>
      </div>
    </div>
  );
};

interface CreateKeyModalProps {
    onClose: () => void;
    onToast: (title: string, msg: string, type: ToastType) => void;
    onSuccess?: () => void;
}

const CreateKeyModal: React.FC<CreateKeyModalProps> = ({ onClose, onToast, onSuccess }) => {
    const [searchUser, setSearchUser] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [searchResults, setSearchResults] = useState<User[]>([]);
    const [isTrial, setIsTrial] = useState(false);
    const [isForever, setIsForever] = useState(false);
    const [params, setParams] = useState({ days: 30, traffic: 100, devices: 5 });
    const [selectedSquads, setSelectedSquads] = useState<string[]>([]);
    const [squads, setSquads] = useState<{uuid: string; name: string}[]>([]);
    const [loadingSquads, setLoadingSquads] = useState(false);

    useEffect(() => {
        if (!searchUser.trim() || selectedUser) {
            setSearchResults([]);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const data = await apiFetch(`/panel/users?search=${encodeURIComponent(searchUser.trim())}&limit=8`);
                if (!cancelled) {
                    const raw = data?.users ?? [];
                    setSearchResults(raw.map(mapApiUser));
                }
            } catch {
                if (!cancelled) setSearchResults([]);
            }
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [searchUser, selectedUser]);

    const filteredUsers = searchResults;

    useEffect(() => {
        (async () => {
            setLoadingSquads(true);
            try {
                const data = await apiFetch('/panel/remnawave/squads');
                if (Array.isArray(data)) {
                    setSquads(data);
                }
            } catch (e) {
                console.error('Failed to load squads', e);
                onToast('Ошибка', 'Не удалось загрузить сквады из Remnawave', 'error');
            } finally {
                setLoadingSquads(false);
            }
        })();
    }, []);

    const handleCreate = async () => {
        if(!selectedUser) {
            onToast('Ошибка', 'Выберите пользователя', 'error');
            return;
        }
        try {

            const finalDays = isForever ? 27394 : params.days;
            const response = await apiFetch('/panel/keys', {
                method: 'POST',
                body: JSON.stringify({
                    user_id: selectedUser.id,
                    days: finalDays,
                    traffic: params.traffic,
                    devices: params.devices,
                    is_trial: isTrial,
                    is_forever: isForever,
                    squads: selectedSquads
                })
            });
            onToast('Успех', isForever ? 'Бесконечный ключ создан!' : 'Ключ успешно создан и отправлен пользователю', 'success');
            onSuccess?.();
            onClose();
        } catch (e: any) {
            onToast('Ошибка', e.message || 'Не удалось создать ключ', 'error');
        }
    };

    useEffect(() => {
        if(isTrial) {
            setParams({ days: 1, traffic: 5, devices: 1 });
        } else if (isForever) {
            setParams(prev => ({ ...prev, traffic: 0, devices: 10 }));
        } else {
            setParams({ days: 30, traffic: 100, devices: 5 });
        }
    }, [isTrial, isForever]);

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl relative animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-gray-800 flex justify-between items-center"><h3 className="text-xl font-bold text-white flex items-center"><Plus size={24} className="mr-2 text-blue-500"/> Создание ключа</h3><button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button></div>
                <div className="p-6 overflow-y-auto space-y-6">
                    <div className="relative">
                        <label className="text-sm font-medium text-gray-400 mb-1.5 block">Пользователь</label>
                        <div className="relative">
                            <input
                                type="text"
                                value={selectedUser ? selectedUser.username : searchUser}
                                onChange={e => {
                                    setSearchUser(e.target.value);
                                    setSelectedUser(null);
                                }}
                                className={`w-full bg-gray-950 border ${
                                    selectedUser ? 'border-green-500/50 text-green-400' : 'border-gray-700 text-white'
                                } rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500`}
                                placeholder="Введите ID или Username"
                            />
                            {selectedUser && (
                                <CheckCircle size={18} className="absolute right-4 top-3.5 text-green-500" />
                            )}
                        </div>
                        {searchUser && !selectedUser && filteredUsers.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-10 overflow-hidden">
                                {filteredUsers.map((u: User) => (
                                    <div
                                        key={u.id}
                                        onClick={() => {
                                            setSelectedUser(u);
                                            setSearchUser('');
                                        }}
                                        className="px-4 py-3 hover:bg-gray-700 cursor-pointer flex justify-between items-center"
                                    >
                                        <span className="text-white">{u.username}</span>
                                        <span className="text-xs text-gray-500">ID: {u.telegramId}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <label className="flex items-center cursor-pointer p-4 bg-gray-800/50 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors"><div className="relative"><input type="checkbox" checked={isTrial} onChange={() => { setIsTrial(!isTrial); setIsForever(false); }} className="sr-only" /><div className={`w-10 h-6 bg-gray-700 rounded-full transition-colors ${isTrial ? 'bg-purple-600' : ''}`}></div><div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform ${isTrial ? 'translate-x-4' : ''}`}></div></div><div className="ml-3"><div className="font-medium text-white">Пробный период</div><div className="text-xs text-gray-500">1 день, 5ГБ</div></div></label>
                        <label className="flex items-center cursor-pointer p-4 bg-gray-800/50 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors"><div className="relative"><input type="checkbox" checked={isForever} onChange={() => { setIsForever(!isForever); setIsTrial(false); }} className="sr-only" /><div className={`w-10 h-6 bg-gray-700 rounded-full transition-colors ${isForever ? 'bg-yellow-500' : ''}`}></div><div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform ${isForever ? 'translate-x-4' : ''}`}></div></div><div className="ml-3"><div className="font-medium text-white">∞ Навсегда</div><div className="text-xs text-gray-500">До 2099 года</div></div></label>
                    </div>
                    <div className="grid grid-cols-3 gap-4"><div><label className="text-xs text-gray-500 mb-1.5 block">Длительность (дней)</label><input type="number" min="1" value={isForever ? 27394 : params.days} disabled={isForever} onChange={e => setParams({...params, days: parseInt(e.target.value) || 0})} className={`w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-white text-center font-mono ${isForever ? 'opacity-50' : ''}`}/></div><div><label className="text-xs text-gray-500 mb-1.5 block">Трафик (GB)</label><input type="number" min="1" value={params.traffic} onChange={e => setParams({...params, traffic: parseInt(e.target.value) || 0})} className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-white text-center font-mono"/></div><div><label className="text-xs text-gray-500 mb-1.5 block">Устройства</label><input type="number" min="1" value={params.devices} onChange={e => setParams({...params, devices: parseInt(e.target.value) || 0})} className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-white text-center font-mono"/></div></div>
                    <div>
                        <label className="text-sm font-medium text-gray-400 mb-2 block">Доступные сквады</label>
                        {loadingSquads ? (
                            <div className="text-gray-500 text-sm">Загрузка сквадов...</div>
                        ) : squads.length === 0 ? (
                            <div className="text-gray-500 text-sm">Нет доступных сквадов</div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {squads.map(sq => {
                                    const isSelected = selectedSquads.includes(sq.uuid);
                                    return (
                                        <button
                                            key={sq.uuid}
                                            onClick={() => setSelectedSquads(prev => isSelected ? prev.filter(s => s !== sq.uuid) : [...prev, sq.uuid])}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${isSelected ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-gray-950 border-gray-800 text-gray-500 hover:border-gray-600'}`}
                                        >
                                            {sq.name}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-5 border-t border-gray-800"><button onClick={handleCreate} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-colors">Создать ключ</button></div>
            </div>
        </div>
    );
};

interface UserSubscription {
  id: number;
  key_uuid: string;
  short_uuid: string;
  status: string;
  expiry_date: string;
  days_left: number;
  traffic_used: number;
  traffic_limit: number;
  type: string;
}

const DeleteReferralsModal: React.FC<{
  user: User;
  onClose: () => void;
  onToast: (title: string, msg: string, type: ToastType) => void;
  onDone: () => void;
}> = ({ user, onClose, onToast, onDone }) => {
  const [step, setStep] = useState(1);
  const [referralCount, setReferralCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [confirmTgId, setConfirmTgId] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [finalCheck, setFinalCheck] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch(`/panel/users/${user.id}/referrals`);
        setReferralCount(data?.count ?? 0);
      } catch {
        setReferralCount(0);
      } finally {
        setLoading(false);
      }
    })();
  }, [user.id]);

  const handleDelete = async () => {
    if (!finalCheck || confirmPhrase !== 'УДАЛИТЬ РЕФЕРАЛОВ') {
      onToast('Ошибка', 'Подтвердите все шаги', 'error');
      return;
    }
    setDeleting(true);
    try {
      const res = await apiFetch(`/panel/users/${user.id}/delete-referrals`, {
        method: 'POST',
        body: JSON.stringify({
          confirm_phrase: confirmPhrase,
          confirm_telegram_id: confirmTgId,
        }),
      });
      onToast('Готово', res?.message || `Удалено: ${res?.deleted_count ?? 0}`, res?.success ? 'success' : 'warning');
      onDone();
      onClose();
    } catch (e: any) {
      onToast('Ошибка', e.message || 'Не удалось удалить рефералов', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-950 border border-red-900/50 rounded-2xl w-full max-w-md shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-red-400 mb-4">
          <AlertTriangle size={22} />
          <h3 className="text-lg font-bold text-white">Удаление рефералов из БД</h3>
        </div>
        {loading ? (
          <p className="text-gray-400 text-sm">Загрузка...</p>
        ) : (
          <>
            <p className="text-gray-400 text-sm mb-4">
              Пользователь <span className="text-white font-mono">{user.username}</span> (TG {user.telegramId}).
              Будет безвозвратно удалено из базы: <strong className="text-red-400">{referralCount}</strong> реферал(ов) и все их данные (ключи, транзакции).
            </p>
            {step === 1 && (
              <div className="space-y-3">
                <p className="text-xs text-yellow-500/90">Используйте только при накрутке рефералов. Действие необратимо.</p>
                <button
                  disabled={referralCount === 0}
                  onClick={() => setStep(2)}
                  className="w-full py-2.5 bg-red-600/20 text-red-400 border border-red-600/30 rounded-lg text-sm font-bold disabled:opacity-40"
                >
                  {referralCount === 0 ? 'Нет рефералов' : 'Я понимаю, продолжить'}
                </button>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-3">
                <label className="text-xs text-gray-500">Введите Telegram ID реферера для подтверждения</label>
                <input
                  type="text"
                  value={confirmTgId}
                  onChange={e => setConfirmTgId(e.target.value)}
                  placeholder={String(user.telegramId)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                />
                <button onClick={() => setStep(3)} className="w-full py-2 bg-gray-800 text-white rounded-lg text-sm">Далее</button>
              </div>
            )}
            {step === 3 && (
              <div className="space-y-3">
                <label className="text-xs text-gray-500">Введите фразу: УДАЛИТЬ РЕФЕРАЛОВ</label>
                <input
                  type="text"
                  value={confirmPhrase}
                  onChange={e => setConfirmPhrase(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono"
                />
                <button onClick={() => setStep(4)} className="w-full py-2 bg-gray-800 text-white rounded-lg text-sm">Далее</button>
              </div>
            )}
            {step === 4 && (
              <div className="space-y-3">
                <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={finalCheck} onChange={e => setFinalCheck(e.target.checked)} className="mt-1" />
                  <span>Я подтверждаю безвозвратное удаление {referralCount} реферал(ов) и всех связанных данных</span>
                </label>
                <button
                  onClick={handleDelete}
                  disabled={deleting || !finalCheck || confirmPhrase !== 'УДАЛИТЬ РЕФЕРАЛОВ' || confirmTgId !== String(user.telegramId)}
                  className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-bold disabled:opacity-40"
                >
                  {deleting ? 'Удаление...' : 'УДАЛИТЬ НАВСЕГДА'}
                </button>
              </div>
            )}
          </>
        )}
        <button onClick={onClose} className="w-full mt-4 py-2 text-gray-500 text-sm hover:text-white">Отмена</button>
      </div>
    </div>
  );
};

interface UserDetailModalProps {
  user: User | null;
  onClose: () => void;
  onToast: (title: string, message: string, type: 'success' | 'error' | 'info') => void;
  onUserPatch?: (userId: number, patch: Partial<User>) => void;
}

const UserDetailModal: React.FC<UserDetailModalProps> = ({ user, onClose, onToast, onUserPatch }) => {
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [selectedSubId, setSelectedSubId] = useState<number | null>(null);
  const [referralsCount, setReferralsCount] = useState(0);
  const [showDeleteReferrals, setShowDeleteReferrals] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [partnerBalance, setPartnerBalance] = useState(user?.partnerBalance ?? 0);
  const [withdrawBlocked, setWithdrawBlocked] = useState(user?.referralWithdrawBlocked ?? false);
  const [referralBalanceInput, setReferralBalanceInput] = useState(String(user?.partnerBalance ?? 0));
  const [savingReferral, setSavingReferral] = useState(false);

  useEffect(() => {
    if (!user) return;
    setPartnerBalance(user.partnerBalance);
    setWithdrawBlocked(user.referralWithdrawBlocked);
    setReferralBalanceInput(String(user.partnerBalance));
  }, [user]);

  const reloadSubscriptions = async () => {
    try {
      const data = await apiFetch(`/panel/users/${user.id}/subscriptions`);
      if (Array.isArray(data)) {
        setSubscriptions(data);
        if (data.length > 0 && !data.find(s => s.id === selectedSubId)) {
          setSelectedSubId(data[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to load subscriptions', e);
    }
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [subsData, refData] = await Promise.all([
          apiFetch(`/panel/users/${user.id}/subscriptions`),
          apiFetch(`/panel/users/${user.id}/referrals`),
        ]);
        if (Array.isArray(subsData)) {
          setSubscriptions(subsData);
          if (subsData.length > 0) setSelectedSubId(subsData[0].id);
        }
        setReferralsCount(refData?.count ?? 0);
      } catch (e) {
        console.error('Failed to load user data', e);
      } finally {
        setLoadingSubs(false);
      }
    })();
  }, [user]);

  if (!user) return null;
  const trafficPercent = (user.traffic / user.maxTraffic) * 100;
  const devicesPercent = (user.devices / user.maxDevices) * 100;

  const handleAction = (type: string) => setActiveAction(type);
  const confirmAction = async (value: string, notify: boolean) => {
      try {
        const res = await apiFetch(`/panel/users/${user.id}/action`, {
          method: 'POST',
          body: JSON.stringify({ action: activeAction, value, notify, subscription_id: selectedSubId })
        });
        if (typeof res?.partner_balance === 'number') {
          setPartnerBalance(res.partner_balance);
          setReferralBalanceInput(String(res.partner_balance));
          onUserPatch?.(user.id, { partnerBalance: res.partner_balance });
        }
        if (typeof res?.referral_withdraw_blocked === 'boolean') {
          setWithdrawBlocked(res.referral_withdraw_blocked);
          onUserPatch?.(user.id, { referralWithdrawBlocked: res.referral_withdraw_blocked });
        }
        onToast('Успешно', `Действие выполнено`, 'success');
        await reloadSubscriptions();
      } catch (e) {
        onToast('Ошибка', 'Не удалось выполнить действие', 'error');
      }
      setActiveAction(null);
  };

  const saveReferralBalance = async () => {
    const amount = Number(referralBalanceInput);
    if (!Number.isFinite(amount) || amount < 0) {
      onToast('Ошибка', 'Укажите корректную сумму', 'error');
      return;
    }
    setSavingReferral(true);
    try {
      const res = await apiFetch(`/panel/users/${user.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'SET_REFERRAL_BALANCE', value: String(amount), notify: false }),
      });
      const next = typeof res?.partner_balance === 'number' ? res.partner_balance : amount;
      setPartnerBalance(next);
      setReferralBalanceInput(String(next));
      onUserPatch?.(user.id, { partnerBalance: next });
      onToast('Успешно', 'Реферальный баланс обновлён', 'success');
    } catch (e: any) {
      onToast('Ошибка', e?.message || 'Не удалось изменить реферальный баланс', 'error');
    } finally {
      setSavingReferral(false);
    }
  };

  const toggleReferralWithdrawBlock = async () => {
    const action = withdrawBlocked ? 'UNBLOCK_REFERRAL_WITHDRAW' : 'BLOCK_REFERRAL_WITHDRAW';
    try {
      const res = await apiFetch(`/panel/users/${user.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action, value: '', notify: true }),
      });
      const next = typeof res?.referral_withdraw_blocked === 'boolean' ? res.referral_withdraw_blocked : !withdrawBlocked;
      setWithdrawBlocked(next);
      onUserPatch?.(user.id, { referralWithdrawBlocked: next });
      onToast('Успешно', next ? 'Вывод заблокирован' : 'Вывод разрешён', 'success');
    } catch (e: any) {
      onToast('Ошибка', e?.message || 'Не удалось изменить блокировку вывода', 'error');
    }
  };

  const handleNotify = async () => {
    const message = prompt('Введите сообщение для отправки пользователю:');
    if (!message) return;
    try {
      await apiFetch(`/panel/users/${user.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'NOTIFY', value: message, notify: true })
      });
      onToast('Успешно', 'Уведомление отправлено', 'success');
    } catch (e) {
      onToast('Ошибка', 'Не удалось отправить уведомление', 'error');
    }
  };

  const handleBlockSubscription = async (subId: number, block: boolean) => {
    try {
      await apiFetch(`/panel/keys/${subId}/block`, {
        method: 'POST',
        body: JSON.stringify({ blocked: block })
      });
      onToast('Успешно', block ? 'Подписка заблокирована' : 'Подписка разблокирована', 'success');
      await reloadSubscriptions();
    } catch (e) {
      onToast('Ошибка', 'Не удалось изменить статус подписки', 'error');
    }
  };

  const handleAddSubscription = async () => {
    const daysStr = prompt('Срок новой подписки (дней):', '30');
    if (!daysStr) return;
    const days = parseInt(daysStr, 10);
    if (!days || days < 1) {
      onToast('Ошибка', 'Укажите корректное число дней', 'error');
      return;
    }
    setAddingSub(true);
    try {
      await apiFetch('/panel/keys', {
        method: 'POST',
        body: JSON.stringify({
          user_id: user.id,
          days,
          traffic: 100,
          devices: 1,
          is_trial: false,
          is_forever: false,
          squads: [],
        }),
      });
      onToast('Успех', 'Новая подписка создана', 'success');
      await reloadSubscriptions();
    } catch (e: any) {
      onToast('Ошибка', e.message || 'Не удалось создать подписку', 'error');
    } finally {
      setAddingSub(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto" onClick={onClose}>
        {activeAction && <UserActionModal type={activeAction} onClose={() => setActiveAction(null)} onConfirm={confirmAction} />}
        {showDeleteReferrals && (
          <DeleteReferralsModal
            user={user}
            onClose={() => setShowDeleteReferrals(false)}
            onToast={onToast}
            onDone={() => setReferralsCount(0)}
          />
        )}
        <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-4xl shadow-2xl relative animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-800 flex justify-between items-start bg-gray-900 rounded-t-2xl">
                <div className="flex items-center gap-4"><div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center text-2xl font-bold text-gray-500 border border-gray-700">{user.username.charAt(1).toUpperCase()}</div><div><h2 className="text-2xl font-bold text-white flex items-center">{user.username} {user.status === 'Active' && <CheckCircle size={18} className="text-green-500 ml-2" />}{user.status === 'Banned' && <Ban size={18} className="text-red-500 ml-2" />}{user.inBlacklist && <span className="ml-2 text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30">Чёрный список</span>}</h2><div className="flex items-center gap-3 text-sm text-gray-400 mt-1"><span className="flex items-center bg-gray-800 px-2 py-0.5 rounded"><Hash size={12} className="mr-1"/> ID: {user.telegramId}</span><span className="flex items-center"><Calendar size={12} className="mr-1"/> Рег: {user.regDate}</span></div></div></div>
                <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                    {}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                        <div className="flex justify-between items-start mb-4">
                          <h3 className="text-lg font-bold text-gray-200 flex items-center">
                            <DollarSign size={18} className="mr-2 text-emerald-400"/> Реферальный баланс
                          </h3>
                          {withdrawBlocked && (
                            <span className="text-[10px] uppercase tracking-wide bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full">
                              Вывод заблокирован
                            </span>
                          )}
                        </div>
                        <div className="text-3xl font-bold text-white mb-4">{partnerBalance} ₽</div>
                        <div className="space-y-3">
                          <div>
                            <label className="text-xs text-gray-500 block mb-1.5">Изменить сумму (₽)</label>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={referralBalanceInput}
                                onChange={(e) => setReferralBalanceInput(e.target.value)}
                                className="flex-1 bg-gray-950 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 font-mono outline-none focus:ring-1 focus:ring-emerald-500"
                              />
                              <button
                                onClick={saveReferralBalance}
                                disabled={savingReferral}
                                className="px-4 py-2 bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 border border-emerald-600/30 rounded-lg text-sm font-medium disabled:opacity-50"
                              >
                                {savingReferral ? '...' : 'Сохранить'}
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => handleAction('ADD_REFERRAL_BALANCE')} className="bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-600/20 py-2 rounded-lg text-sm font-medium transition-colors flex justify-center items-center">
                              <ArrowUpRight size={14} className="mr-2"/> Начислить
                            </button>
                            <button onClick={() => handleAction('SUB_REFERRAL_BALANCE')} className="bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20 py-2 rounded-lg text-sm font-medium transition-colors flex justify-center items-center">
                              <ArrowDownLeft size={14} className="mr-2"/> Списать
                            </button>
                          </div>
                          <button
                            onClick={toggleReferralWithdrawBlock}
                            className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                              withdrawBlocked
                                ? 'bg-green-600/10 hover:bg-green-600/20 text-green-400 border-green-600/20'
                                : 'bg-red-600/10 hover:bg-red-600/20 text-red-400 border-red-600/20'
                            }`}
                          >
                            {withdrawBlocked ? 'Разрешить вывод' : 'Заблокировать вывод'}
                          </button>
                        </div>
                    </div>
                    {}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                         <div className="flex justify-between items-center mb-4">
                           <h3 className="text-lg font-bold text-gray-200 flex items-center">
                             <Zap size={18} className="mr-2 text-blue-400"/> Подписки ({subscriptions.length})
                           </h3>
                           <button
                             onClick={handleAddSubscription}
                             disabled={addingSub}
                             className="text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/30 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                           >
                             {addingSub ? '...' : '+ Добавить'}
                           </button>
                         </div>
                         {loadingSubs ? (
                           <div className="text-center py-4 text-gray-500">Загрузка...</div>
                         ) : subscriptions.length === 0 ? (
                           <div className="text-center py-4 text-gray-500">Нет активных подписок</div>
                         ) : (
                           <div className="space-y-3 max-h-[300px] overflow-y-auto">
                             {subscriptions.map((sub) => (
                               <div
                                 key={sub.id}
                                 onClick={() => setSelectedSubId(sub.id)}
                                 className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                                   selectedSubId === sub.id
                                     ? 'bg-blue-600/10 border-blue-500/50'
                                     : 'bg-gray-950 border-gray-800 hover:border-gray-700'
                                 }`}
                               >
                                 <div className="flex justify-between items-start mb-2">
                                   <div>
                                     <div className="font-mono text-xs text-blue-400">#{sub.short_uuid || sub.key_uuid?.slice(0,8)}</div>
                                     <div className="text-xs text-gray-500 mt-0.5">{sub.type === 'whitelist' ? 'Обход списков' : 'VPN'}</div>
                                   </div>
                                   <span className={`text-xs px-2 py-0.5 rounded ${
                                     sub.status === 'Active' ? 'bg-green-500/20 text-green-400' :
                                     sub.status === 'Blocked' ? 'bg-red-500/20 text-red-400' :
                                     'bg-gray-500/20 text-gray-400'
                                   }`}>{sub.status}</span>
                                 </div>
                                 <div className="flex justify-between text-xs">
                                   <span className={sub.days_left <= 3 ? 'text-red-400' : 'text-gray-400'}>
                                     {sub.days_left <= 0 ? 'Истекла' : `Осталось ${sub.days_left} дн.`}
                                   </span>
                                   <span className="text-gray-500">
                                     {sub.traffic_limit > 0
                                       ? `${(sub.traffic_used / (1024**3)).toFixed(1)} / ${(sub.traffic_limit / (1024**3)).toFixed(0)} ГБ`
                                       : 'Безлимит'
                                     }
                                   </span>
                                 </div>
                                 {selectedSubId === sub.id && (
                                   <div className="mt-3 pt-3 border-t border-gray-800 flex gap-2">
                                     <button
                                       onClick={(e) => { e.stopPropagation(); handleBlockSubscription(sub.id, sub.status !== 'Blocked'); }}
                                       className={`flex-1 py-1.5 rounded text-xs font-medium ${
                                         sub.status === 'Blocked'
                                           ? 'bg-green-600/10 text-green-400 border border-green-600/20 hover:bg-green-600/20'
                                           : 'bg-red-600/10 text-red-400 border border-red-600/20 hover:bg-red-600/20'
                                       }`}
                                     >
                                       {sub.status === 'Blocked' ? 'Разблокировать' : 'Заблокировать'}
                                     </button>
                                   </div>
                                 )}
                               </div>
                             ))}
                           </div>
                         )}
                    </div>
                    {}
                    {user.isPartner && (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                            <h3 className="text-lg font-bold text-gray-200 flex items-center mb-4"><Users size={18} className="mr-2 text-indigo-400"/> Партнёрская программа</h3>
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div className="bg-gray-950 p-3 rounded-xl border border-gray-800">
                                    <div className="text-xs text-gray-500">Реф. баланс</div>
                                    <div className="text-xl font-bold text-white">{partnerBalance} ₽</div>
                                </div>
                                <div className="bg-gray-950 p-3 rounded-xl border border-gray-800">
                                    <div className="text-xs text-gray-500">Рефералов</div>
                                    <div className="text-xl font-bold text-white">{referralsCount}</div>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <div><label className="text-xs text-gray-500 block mb-1">Реф. код</label><input type="text" defaultValue={user.refCode} className="w-full bg-gray-950 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 font-mono"/></div>
                                <div><label className="text-xs text-gray-500 block mb-1">Ставка (%)</label><input type="number" defaultValue={user.partnerRate} className="w-full bg-gray-950 border border-gray-700 text-white text-sm rounded-lg px-3 py-2"/></div>
                                <button onClick={() => onToast('Успех', 'Настройки партнера сохранены', 'success')} className="w-full mt-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-600/20 py-2 rounded-lg text-sm font-bold transition-colors">Сохранить настройки партнёра</button>
                            </div>
                        </div>
                    )}
                </div>
                <div className="space-y-6">
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                         <h3 className="text-lg font-bold text-gray-200 flex items-center mb-4"><Settings size={18} className="mr-2 text-orange-400"/> Управление подпиской</h3>
                         <div className="grid grid-cols-2 gap-3"><button onClick={() => handleAction('EXTEND_SUB')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Продлить</button><button onClick={() => handleAction('REDUCE_SUB')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Уменьшить срок</button><button onClick={() => handleAction('SET_TRAFFIC')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Изм. макс. трафик</button><button onClick={() => handleAction('SET_DEVICES')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Изм. кол-во уст.</button><button className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors col-span-2">Добавить Squad</button></div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                         <h3 className="text-lg font-bold text-gray-200 flex items-center mb-4"><Edit2 size={18} className="mr-2 text-gray-400"/> Редактирование профиля</h3>
                         <div className="space-y-3"><div><label className="text-xs text-gray-500 block mb-1">Username</label><input type="text" defaultValue={user.username} className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-500 outline-none" /></div><div><label className="text-xs text-gray-500 block mb-1">Имя</label><input type="text" defaultValue={user.name} className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-500 outline-none" /></div><div className="flex gap-4 pt-2"><label className="flex items-center text-sm text-gray-300 cursor-pointer"><input type="checkbox" defaultChecked={user.firstDeposit} className="form-checkbox bg-gray-800 border-gray-700 rounded text-blue-500 mr-2"/>Первое пополнение</label><label className="flex items-center text-sm text-gray-300 cursor-pointer"><input type="checkbox" defaultChecked={user.wasPaid} className="form-checkbox bg-gray-800 border-gray-700 rounded text-blue-500 mr-2"/>Была подписка</label></div><button onClick={() => onToast('Успех', 'Данные пользователя сохранены', 'success')} className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-900/20">Сохранить изменения</button></div>
                    </div>
                    {}
                    <div className="bg-gray-900 border border-red-900/40 rounded-xl p-5">
                         <h3 className="text-lg font-bold text-gray-200 flex items-center mb-2">
                           <UserMinus size={18} className="mr-2 text-red-400"/> Рефералы
                         </h3>
                         <p className="text-xs text-gray-500 mb-3">
                           Прямых рефералов: <span className="text-white font-bold">{referralsCount}</span>
                         </p>
                         <button
                           onClick={() => setShowDeleteReferrals(true)}
                           disabled={referralsCount === 0}
                           className="w-full py-2.5 bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center justify-center"
                         >
                           <Trash2 size={16} className="mr-2" />
                           Удалить всех рефералов из БД
                         </button>
                    </div>
                    {}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                         <h3 className="text-lg font-bold text-gray-200 flex items-center mb-4"><Bell size={18} className="mr-2 text-yellow-400"/> Действия</h3>
                         <div className="grid grid-cols-1 gap-3">
                           <button onClick={handleNotify} className="bg-yellow-600/10 hover:bg-yellow-600/20 text-yellow-400 border border-yellow-600/20 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center">
                             <Bell size={16} className="mr-2" /> Уведомить пользователя
                           </button>
                           {user.status !== 'Banned' && !user.inBlacklist ? (
                             <button onClick={() => handleAction('BAN')} className="bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center">
                               <Ban size={16} className="mr-2" /> Заблокировать
                             </button>
                           ) : (
                             <button onClick={() => handleAction('UNBAN')} className="bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-600/20 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center">
                               <CheckCircle size={16} className="mr-2" /> Разблокировать{user.inBlacklist ? ' (из ЧС)' : ''}
                             </button>
                           )}
                         </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};

function LoginForm({ onLogin }: { onLogin: (secret: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpId, setOtpId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [initInfo, setInitInfo] = useState<{username?: string; password?: string; newAdmin?: boolean} | null>(null);

  useEffect(() => {
    fetch('/api/panel/auth/init')
      .then(res => res.json())
      .then(data => {
        if (data.new_admin && data.password) {
          setInitInfo({
            username: data.username,
            password: data.password,
            newAdmin: true
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/panel/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok && data.requires_otp && data.otp_id) {
        setOtpId(data.otp_id);
      } else if (res.ok && data.session_token) {
        setPanelSecret(data.session_token);
        onLogin(data.session_token);
      } else {
        setError(data.error || 'Неверные учетные данные');
      }
    } catch (err) {
      setError('Ошибка подключения к серверу');
    }
    setLoading(false);
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/panel/auth/verify-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ otp_id: otpId, code: otpCode })
      });
      const data = await res.json();
      if (res.ok) {
        setPanelSecret(data.session_token);
        onLogin(data.session_token);
      } else {
        setError(data.error || 'Неверный код');
      }
    } catch {
      setError('Ошибка подключения к серверу');
    }
    setLoading(false);
  };

  return (
    <div className="mono-theme min-h-screen bg-black flex items-center justify-center p-4">
      <div className="bg-gray-900/90 border border-gray-700 rounded-2xl p-8 w-full max-w-md shadow-2xl backdrop-blur-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-gray-100 to-gray-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">1FEDERAL VPN Admin</h1>
          <p className="text-gray-400 mt-2">Безопасный вход в панель</p>
        </div>

        {}
        {initInfo?.newAdmin && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg text-sm mb-6">
            <p className="font-bold mb-2">Создан администратор!</p>
            <p>Логин: <code className="bg-green-900/30 px-1 rounded">{initInfo.username}</code></p>
            <p>Пароль: <code className="bg-green-900/30 px-1 rounded">{initInfo.password}</code></p>
            <p className="mt-2 text-xs text-green-500">Сохраните эти данные! Пароль показывается только один раз.</p>
          </div>
        )}

        {!otpId ? (
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Логин</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:ring-2 focus:ring-gray-300 focus:border-transparent outline-none transition-all"
                placeholder="admin"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:ring-2 focus:ring-gray-300 focus:border-transparent outline-none transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full bg-gradient-to-r from-gray-200 to-white hover:from-white hover:to-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 rounded-lg transition-all"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <Loader size={20} className="animate-spin mr-2" />
                  Вход...
                </span>
              ) : (
                'Войти'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Код подтверждения
              </label>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:ring-2 focus:ring-gray-300 focus:border-transparent outline-none transition-all"
                placeholder="6-значный код из Telegram"
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || otpCode.length !== 6}
              className="w-full bg-gradient-to-r from-gray-200 to-white hover:from-white hover:to-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 rounded-lg transition-all"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <Loader size={20} className="animate-spin mr-2" />
                  Проверка...
                </span>
              ) : (
                'Войти'
              )}
            </button>

            <p className="text-gray-500 text-xs text-center mt-2">Код отправлен администраторам в Telegram.</p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function App() {

  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const secret = getPanelSecret();
    if (!secret) {
      setIsAuthenticated(false);
      return;
    }

    fetch('/api/panel/stats/summary', {
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type': 'application/json'
      }
    }).then(res => {
      if (res.ok) {
        setIsAuthenticated(true);
      } else {
        clearPanelSecret();
        setIsAuthenticated(false);
      }
    }).catch(() => {
      setIsAuthenticated(false);
    });
  }, []);

  const handleLogin = (secret: string) => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    clearPanelSecret();
    setIsAuthenticated(false);
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader size={40} className="animate-spin text-blue-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm onLogin={handleLogin} />;
  }

  return <AuthenticatedApp onLogout={handleLogout} />;
}

function AuthenticatedApp({ onLogout }: { onLogout: () => void }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activePage, setActivePage] = useState("Главная страница");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [totalRevenue, setTotalRevenue] = useState<number>(0);

  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [massActionType, setMassActionType] = useState<string | null>(null);
  const [keySearch, setKeySearch] = useState('');
  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);

  const [editingKey, setEditingKey] = useState<KeyItem | null>(null);

  const addToast = (title: string, message: string, type: ToastType = 'success') => {
      const id = Date.now();
      setToasts(prev => [...prev, { id, title, message, type }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const refetchKeys = async () => {
    try {
      const keysFromApi = await apiFetch('/panel/keys?limit=500');
      if (Array.isArray(keysFromApi)) {
        const mappedKeys: KeyItem[] = keysFromApi.map((k: any) => ({
          id: k.id,
          key: k.key_config || k.key_uuid || `key_${k.id}`,
          user: k.username || `@user_${k.user_id}`,
          status: (k.status as KeyStatus) || 'Active',
          expiry: k.expiry_date
            ? Math.ceil((new Date(k.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : 0,
          trafficUsed: k.traffic_used ?? 0,
          trafficLimit: k.traffic_limit ?? 0,
          devicesUsed: k.devices_used ?? 0,
          devicesLimit: k.devices_limit ?? 1,
          server: k.server_location || 'Unknown',
        }));
        setKeys(mappedKeys);
      }
    } catch (e) {
      console.error('Failed to refetch keys', e);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {

        try {
          const transactionsFromApi = await apiFetch('/panel/transactions?limit=100');
          if (!cancelled && Array.isArray(transactionsFromApi)) {
            const mapped: Transaction[] = transactionsFromApi.map((t: any) => ({
              id: t.id,
              user: t.user || `@user_${t.user_id}`,
              amount: t.amount ?? 0,
              type: t.amount > 0 ? 'income' : 'expense',
              status: t.status || 'Pending',
              method: t.payment_method || 'Unknown',
              date: t.created_at
                ? new Date(t.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '',
              hash: t.hash || t.payment_id || '',
            }));
            setTransactions(mapped);
          }
        } catch (e) {
          console.error('Failed to load transactions from API', e);
          if (!cancelled) {
            addToast('Ошибка', 'Не удалось загрузить транзакции', 'error');
            setTransactions([]);
          }
        }

        try {
          const promosFromApi = await apiFetch('/panel/promocodes');
          if (!cancelled && Array.isArray(promosFromApi)) {
            const mappedPromos: Promo[] = promosFromApi.map((p: any) => ({
              id: p.id,
              code: p.code,
              type: p.type,
              value: String(p.value),
              uses: p.uses_count ?? 0,
              limit: p.uses_limit ?? 0,
              expires: p.expires_at
                ? new Date(p.expires_at).toLocaleDateString('ru-RU')
                : 'Бессрочно',
            }));
            setPromos(mappedPromos);
          }
        } catch (e) {
          console.error('Failed to load promocodes from API', e);
          if (!cancelled) {
            addToast('Ошибка', 'Не удалось загрузить промокоды', 'error');
            setPromos([]);
          }
        }

        try {
          const keysFromApi = await apiFetch('/panel/keys?limit=500');
          if (!cancelled && Array.isArray(keysFromApi)) {
            const mappedKeys: KeyItem[] = keysFromApi.map((k: any) => ({
              id: k.id,
              key: k.key_config || k.key_uuid || `key_${k.id}`,
              user: k.username || `@user_${k.user_id}`,
              status: (k.status as KeyStatus) || 'Active',
              expiry: k.expiry_date
                ? Math.ceil((new Date(k.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : 0,
              trafficUsed: k.traffic_used ?? 0,
              trafficLimit: k.traffic_limit ?? 0,
              devicesUsed: k.devices_used ?? 0,
              devicesLimit: k.devices_limit ?? 1,
              server: k.server_location || 'Unknown',
            }));
            setKeys(mappedKeys);
          }
        } catch (e) {
          console.error('Failed to load keys from API', e);
          if (!cancelled) {
            addToast('Ошибка', 'Не удалось загрузить ключи', 'error');
            setKeys([]);
          }
        }

        try {
          const summaryData = await apiFetch('/panel/stats/summary');
          if (!cancelled && summaryData) {
            setTotalRevenue(summaryData.total_revenue || summaryData.monthly_revenue || 0);
          }
        } catch (e) {
          console.error('Failed to load revenue stats', e);
        }
      } catch (e) {
        console.error('Initial panel data load failed', e);
        if (!cancelled) {
          addToast('Ошибка', 'Не удалось загрузить данные панели', 'error');
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpdateKey = (id: number, newExpiry: number) => {
      setKeys(prev => prev.map(k => k.id === id ? { ...k, expiry: newExpiry, status: newExpiry > 0 ? 'Active' : 'Expired' } : k));
      setEditingKey(null);
      addToast('Успешно', `Срок действия ключа #${id} обновлен`, 'success');
  };

  const handleDeleteKey = (id: number) => {
      setKeys(prev => prev.filter(k => k.id !== id));
      setEditingKey(null);
      addToast('Удалено', `Ключ #${id} успешно удален`, 'success');
  };

  return (
    <div className="mono-theme min-h-screen bg-black text-gray-100 font-sans selection:bg-white selection:text-black">
      <ToastContainer toasts={toasts} removeToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />

      {selectedTransaction && (<TransactionModal transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />)}
      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onToast={addToast}
          onUserPatch={(id, patch) => {
            setSelectedUser((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
          }}
        />
      )}
      {isCreateKeyOpen && (<CreateKeyModal onClose={() => setIsCreateKeyOpen(false)} onToast={addToast} onSuccess={refetchKeys} />)}
      {editingKey && (<KeyEditModal keyItem={editingKey} onClose={() => setEditingKey(null)} onSave={handleUpdateKey} onDelete={handleDeleteKey} />)}
      {massActionType && <UserActionModal type={massActionType} onClose={() => setMassActionType(null)} onConfirm={async (val, notify) => {
        try {
          await apiFetch('/panel/users/mass-action', {
            method: 'POST',
            body: JSON.stringify({ action: massActionType, value: val, notify })
          });
          addToast('Массовое действие', 'Задача успешно выполнена', 'success');
        } catch (e) {
          addToast('Ошибка', 'Не удалось выполнить действие', 'error');
        }
        setMassActionType(null);
      }} />}

      <aside className={`panel-sidebar fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 border-r border-gray-800 transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 overflow-y-auto custom-scrollbar`}>
        <div className="p-6 border-b border-gray-800 hidden md:block"><h1 className="text-2xl font-bold text-blue-500 tracking-wider">1FEDERAL VPN</h1><p className="text-xs text-gray-500 mt-1">Admin Panel v3.2</p></div>
        <nav className="p-4 space-y-6">
            {[
                { category: "Главное", items: [{ name: "Главная страница", icon: Home }, { name: "Финансы", icon: DollarSign }, { name: "Статистика", icon: BarChart2 }] },
                { category: "Пользователи", items: [{ name: "Пользователи", icon: Users }, { name: "Ключи", icon: Key }] },
                { category: "Маркетинг", items: [{ name: "Рассылка", icon: Mail }, { name: "Промокоды", icon: Gift }] },
                { category: "Система", items: [{ name: "Настройки", icon: Settings }] }
            ].map((section, idx) => (
                <div key={idx}>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 px-2">{section.category}</h3>
                    <ul className="space-y-1">{section.items.map((item, itemIdx) => (<li key={itemIdx}><button onClick={() => { setActivePage(item.name); setIsMobileMenuOpen(false); }} className={`w-full flex items-center px-2 py-2 text-sm font-medium rounded-lg transition-colors ${activePage === item.name ? 'bg-blue-600/10 text-blue-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}><item.icon size={18} className={`mr-3 ${activePage === item.name ? 'text-blue-400' : 'text-gray-500'}`} />{item.name}</button></li>))}</ul>
                </div>
            ))}
        </nav>
      </aside>

      <main className="panel-main md:ml-64 min-h-screen transition-all duration-300">
        <div className="panel-topbar bg-gray-900/50 backdrop-blur-md border-b border-gray-800 sticky top-0 z-30 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-4">
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="md:hidden text-gray-300 hover:text-white p-1">{isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}</button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-blue-600/10 border border-blue-500/20 px-3 py-1.5 rounded-lg hover:bg-blue-600/20 transition-colors cursor-pointer"><DollarSign size={16} className="text-blue-400 mr-2" /><div className="text-lg font-bold text-blue-400 leading-none">{totalRevenue.toLocaleString('ru-RU')} ₽</div></div>
            <button onClick={onLogout} title="Выход" className="flex items-center justify-center w-9 h-9 bg-red-600/10 border border-red-500/20 rounded-lg hover:bg-red-600/20 transition-colors text-red-400"><Lock size={16} /></button>
          </div>
        </div>

        <div className="panel-content p-4 md:p-6">
            {activePage === 'Главная страница' && <Dashboard />}
            {activePage === 'Финансы' && <FinancePage transactions={transactions} onSelectTransaction={setSelectedTransaction} />}
            {activePage === 'Статистика' && <StatisticsPage />}
            {activePage === 'Пользователи' && <UsersPage userSearch={userSearch} setUserSearch={setUserSearch} setSelectedUser={setSelectedUser} setMassActionType={setMassActionType} />}
            {activePage === 'Ключи' && <KeysPage keys={keys} keySearch={keySearch} setKeySearch={setKeySearch} setIsCreateKeyOpen={setIsCreateKeyOpen} setEditingKey={setEditingKey} />}
            {activePage === 'Рассылка' && <MailingPage onToast={addToast} />}
            {activePage === 'Промокоды' && <PromocodesPage promos={promos} setPromos={setPromos} onToast={addToast} />}
            {activePage === 'Настройки' && <SettingsPage onToast={addToast} />}
        </div>
      </main>
    </div>
  );
}

const Dashboard = () => {
    const [usersData, setUsersData] = useState<number[]>([]);
    const [keysData, setKeysData] = useState<number[]>([]);
    const [labels, setLabels] = useState<string[]>([]);
    const [summary, setSummary] = useState<{
        total_users: number;
        active_keys: number;
        monthly_revenue: number;
    } | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/stats/charts');
                if (data) {
                    setUsersData(Array.isArray(data.users) ? data.users : []);
                    setKeysData(Array.isArray(data.keys) ? data.keys : []);
                    setLabels(Array.isArray(data.labels) ? data.labels : []);
                }
            } catch (e) {
                console.error('Failed to load dashboard charts', e);
            }
        })();

        (async () => {
            try {
                const data = await apiFetch('/panel/stats/summary');
                if (data) {
                    setSummary(data);
                }
            } catch (e) {
                console.error('Failed to load dashboard summary', e);
            }
        })();
    }, []);

    const fmtNumber = (v: number) =>
        v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });

    const fmtMoney = (v: number) =>
        `${v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div><h2 className="text-2xl font-bold text-white">Добро пожаловать в панель управления</h2><p className="text-gray-400 mt-1">Вот что происходит с 1FEDERAL VPN сегодня.</p></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard
                title="Всего пользователей"
                value={summary ? fmtNumber(summary.total_users) : '—'}
                icon={Users}
                color="blue"
              />
              <StatCard
                title="Активных ключей"
                value={summary ? fmtNumber(summary.active_keys) : '—'}
                icon={Key}
                color="green"
              />
              <StatCard
                title="Доход за месяц"
                value={summary ? fmtMoney(summary.monthly_revenue) : '—'}
                icon={DollarSign}
                color="indigo"
              />
            </div>
            <div className="grid grid-cols-1 gap-6">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-sm">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-semibold text-gray-200 flex items-center"><TrendingUp className="w-5 h-5 mr-2 text-blue-500" />Новые пользователи и ключи</h3>
                        <span className="text-xs font-medium text-gray-300 bg-gray-700/30 px-2 py-1 rounded">{labels.at(-1) || ''}</span>
                    </div>
                    <DualLineChart labels={labels} users={usersData} keys={keysData} />
                </div>
            </div>
        </div>
    );
};

interface FinancePageProps {
  transactions: Transaction[];
  onSelectTransaction: (t: Transaction) => void;
}

const FinancePage: React.FC<FinancePageProps> = ({ transactions, onSelectTransaction }) => {
    const [stats, setStats] = useState<{
        deposits: number;
        depositsChange: string;
        withdrawals: number;
        withdrawalsChange: string;
        successfulOps: number;
    } | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/finance/stats');
                if (data) {
                    setStats(data);
                }
            } catch (e) {
                console.error('Failed to load finance stats', e);
            }
        })();
    }, []);

    const fmtMoney = (v: number) =>
        `${v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 className="text-2xl font-bold text-white">Финансы</h2><p className="text-gray-400 mt-1">Управление доходами</p></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    title="Пополнения"
                    value={stats ? fmtMoney(stats.deposits) : '—'}
                    change={stats?.depositsChange}
                    icon={ArrowUpRight}
                    color="green"
                />
                <StatCard
                    title="Списания"
                    value={stats ? fmtMoney(stats.withdrawals) : '—'}
                    subValue="(Расходы)"
                    change={stats?.withdrawalsChange}
                    icon={ArrowDownLeft}
                    color="red"
                />
                <StatCard
                    title="Успешные операции"
                    value={stats ? stats.successfulOps.toLocaleString('ru-RU') : '—'}
                    subValue="операций"
                    icon={Activity}
                    color="blue"
                />
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-sm"><div className="overflow-x-auto"><table className="w-full text-left border-collapse"><thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider"><th className="px-6 py-4">ID</th><th className="px-6 py-4">Пользователь</th><th className="px-6 py-4">Сумма</th><th className="px-6 py-4">Статус</th><th className="px-6 py-4">Дата</th></tr></thead><tbody className="divide-y divide-gray-800">{transactions.map((tx) => (<tr key={tx.id} onClick={() => onSelectTransaction(tx)} className="hover:bg-gray-800/30 cursor-pointer"><td className="px-6 py-4 text-sm text-gray-500">#{tx.id}</td><td className="px-6 py-4 text-sm text-gray-300">{tx.user}</td><td className={`px-6 py-4 text-sm font-bold ${tx.amount > 0 ? 'text-green-400' : 'text-white'}`}>{tx.amount > 0 ? '+' : ''}{tx.amount} ₽</td><td className="px-6 py-4 text-sm text-gray-400">{tx.status}</td><td className="px-6 py-4 text-sm text-gray-500">{tx.date}</td></tr>))}</tbody></table></div></div>
        </div>
    );
};

const StatisticsPage = () => {
    const [stats, setStats] = useState<any>(null);
    const [revenuePeriod, setRevenuePeriod] = useState<'7' | '30' | '365'>('30');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const data = await apiFetch(`/panel/statistics/full?period=${revenuePeriod}`);
                if (!cancelled && data) {
                    setStats(data);
                }
            } catch (e) {
                console.error('Failed to load statistics', e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [revenuePeriod]);

    const fmtNumber = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
    const fmtMoney = (v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M ₽` : `${v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`;

    if (!stats && loading) {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div><h2 className="text-2xl font-bold text-white">Статистика</h2><p className="text-gray-400 mt-1">Детальная аналитика проекта</p></div>
                <div className="flex items-center justify-center h-64"><Loader className="animate-spin text-blue-500" size={32} /></div>
            </div>
        );
    }

    if (!stats) {
        return (
            <div className="space-y-6">
                <div><h2 className="text-2xl font-bold text-white">Статистика</h2></div>
                <p className="text-gray-500">Не удалось загрузить данные</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div><h2 className="text-2xl font-bold text-white">Статистика</h2><p className="text-gray-400 mt-1">Детальная аналитика проекта</p></div>

            {}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard title="Всего пользователей" value={fmtNumber(stats.totalUsers)} icon={Users} color="blue" />
                <StatCard title="Активных подписок" value={fmtNumber(stats.activeSubscriptions)} icon={CheckCircle} color="green" />
                <StatCard title="Платежей сегодня" value={fmtNumber(stats.paymentsToday)} icon={CreditCard} color="indigo" />
                <StatCard title="Баланс клиентов" value={fmtMoney(stats.clientsBalance)} icon={Wallet} color="gray" />
            </div>

            {}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-3 bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-gray-200">Выручка по дням</h3>
                        <select
                            value={revenuePeriod}
                            onChange={(e) => setRevenuePeriod(e.target.value as '7' | '30' | '365')}
                            className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="7">За неделю</option>
                            <option value="30">За 30 дней</option>
                            <option value="365">За год</option>
                        </select>
                    </div>
                    <SmoothAreaChart color="#10b981" label="Выручка (₽)" data={stats.revenueData || []} height={250} id="revChart" labels={stats.revenueLabels || []} />
                </div>
                <div className="space-y-4">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col justify-center h-[calc(50%-8px)]">
                        <p className="text-gray-400 text-sm">В среднем в день</p>
                        <div className="text-2xl font-bold text-white mt-1">{fmtMoney(stats.avgDaily || 0)}</div>
                        <div className="text-green-400 text-xs mt-2 flex items-center"><ArrowUpRight size={12} className="mr-1" /> Растет</div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col justify-center h-[calc(50%-8px)]">
                        <p className="text-gray-400 text-sm">Лучший день</p>
                        <div className="text-2xl font-bold text-white mt-1">{fmtMoney(stats.bestDayValue || 0)}</div>
                        <div className="text-gray-500 text-xs mt-2">{stats.bestDayDate || ''}</div>
                    </div>
                </div>
            </div>

            {}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-gray-200 mb-6">Распределение пользователей</h3>
                    <PieChartComponent data={stats.userDistData || []} colors={['#3b82f6', '#ef4444', '#a855f7', '#f97316', '#6b7280']} />
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                     <h3 className="text-lg font-bold text-gray-200 mb-6">Способы оплаты</h3>
                     <PieChartComponent data={stats.paymentMethodsData || []} colors={['#10b981', '#3b82f6', '#f59e0b', '#6b7280']} />
                </div>
            </div>

            {}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-gray-200 mb-4 flex items-center"><Key size={18} className="mr-2 text-blue-400" /> Статистика по подпискам</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    <div className="bg-gray-950 rounded-xl p-4 border border-gray-800">
                        <p className="text-xs text-gray-500 mb-1">Всего ключей</p>
                        <p className="text-xl font-bold text-white">{fmtNumber(stats.totalSubscriptions)}</p>
                    </div>
                    <div className="bg-gray-950 rounded-xl p-4 border border-gray-800">
                        <p className="text-xs text-gray-500 mb-1">Активные</p>
                        <p className="text-xl font-bold text-green-400">{fmtNumber(stats.paidSubscriptions)}</p>
                    </div>
                    <div className="bg-gray-950 rounded-xl p-4 border border-gray-800">
                        <p className="text-xs text-gray-500 mb-1">Истекшие</p>
                        <p className="text-xl font-bold text-red-400">{fmtNumber(stats.expiredSubscriptions)}</p>
                    </div>
                    <div className="bg-gray-950 rounded-xl p-4 border border-gray-800">
                        <p className="text-xs text-gray-500 mb-1">С триалом (актив.)</p>
                        <p className="text-xl font-bold text-purple-400">{fmtNumber(stats.trialActiveSubscriptions)}</p>
                    </div>
                    <div className="bg-gray-950 rounded-xl p-4 border border-gray-800">
                        <p className="text-xs text-gray-500 mb-1">Пользователей с ключами</p>
                        <p className="text-xl font-bold text-white">{fmtNumber(stats.usersWithSubscriptions)}</p>
                    </div>
                    <div className="bg-gray-950 rounded-xl p-4 border border-gray-800">
                        <p className="text-xs text-gray-500 mb-1">Среднее на пользователя</p>
                        <p className="text-xl font-bold text-blue-400">{stats.avgSubscriptionsPerUser ?? 0}</p>
                    </div>
                    <div className="bg-gray-950 rounded-xl p-4 border border-gray-800">
                        <p className="text-xs text-gray-500 mb-1">Новых сегодня</p>
                        <p className="text-xl font-bold text-emerald-400">+{fmtNumber(stats.newSubscriptionsToday)}</p>
                    </div>
                    <div className="bg-gray-950 rounded-xl p-4 border border-gray-800">
                        <p className="text-xs text-gray-500 mb-1">За неделю</p>
                        <p className="text-xl font-bold text-blue-400">+{fmtNumber(stats.boughtThisWeek)}</p>
                    </div>
                    <div className="bg-gray-950 rounded-xl p-4 border border-gray-800">
                        <p className="text-xs text-gray-500 mb-1">За месяц</p>
                        <p className="text-xl font-bold text-indigo-400">+{fmtNumber(stats.boughtThisMonth)}</p>
                    </div>
                </div>
                <div className="mt-8 pt-6 border-t border-gray-800">
                    <h4 className="text-base font-semibold text-gray-300 mb-2">По срокам подписки</h4>
                    <p className="text-xs text-gray-500 mb-6">
                        Доля покупок и продлений по тарифам из настроек. Новые тарифы появятся автоматически.
                    </p>
                    <PieChartComponent
                        data={(stats.subscriptionPlanDist || []).map((item: { label: string; value: number; percent?: number; userCount?: number; purchaseCount?: number }) => ({
                            label: item.label,
                            value: item.value,
                            percent: item.percent,
                            userCount: item.userCount,
                            purchaseCount: item.purchaseCount,
                        }))}
                        colors={['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#f97316', '#6b7280']}
                        centerLabel={fmtNumber(stats.subscriptionPlanTotalPurchases || 0)}
                        centerSubLabel="покупок"
                        emptyMessage="Пока нет оплаченных подписок"
                    />
                </div>
            </div>

            {}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                     <h3 className="text-lg font-bold text-gray-200 mb-4">Конверсия Trial {'>'} Paid</h3>
                     <div className="flex items-end gap-2 mb-2">
                         <span className="text-4xl font-bold text-white">{stats.conversionRate?.toFixed(1) || 0}%</span>
                     </div>
                     <p className="text-xs text-gray-500">Пользователей переходят на платный тариф после пробного периода.</p>
                     <div className="w-full bg-gray-800 h-2 rounded-full mt-4"><div className="bg-green-500 h-2 rounded-full" style={{width: `${Math.min(stats.conversionRate || 0, 100)}%`}}></div></div>
                 </div>
                 <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                     <h3 className="text-lg font-bold text-gray-200 mb-4">Рефералы</h3>
                     <div className="space-y-4">
                         <div className="flex justify-between"><span className="text-gray-400">Всего приглашено</span><span className="text-white font-bold">{fmtNumber(stats.totalInvited)}</span></div>
                         <div className="flex justify-between"><span className="text-gray-400">Партнеров</span><span className="text-white font-bold">{fmtNumber(stats.partners)}</span></div>
                         <div className="flex justify-between"><span className="text-gray-400">Выплачено</span><span className="text-white font-bold">{fmtMoney(stats.totalPaid)}</span></div>
                     </div>
                 </div>
            </div>

            {}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-gray-800"><h3 className="text-lg font-bold text-gray-200">Топ рефералов</h3></div>
                <table className="w-full text-left">
                    <thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase"><th className="px-6 py-4">Пользователь</th><th className="px-6 py-4">Пригласил</th><th className="px-6 py-4">Заработал</th></tr></thead>
                    <tbody className="divide-y divide-gray-800">
                        {(stats.topReferrers || []).map((r: any) => (
                            <tr key={r.id}>
                                <td className="px-6 py-4 text-white font-medium flex items-center"><Trophy size={16} className={`mr-2 ${r.id === 1 ? 'text-yellow-400' : r.id === 2 ? 'text-gray-400' : 'text-orange-400'}`}/> {r.name}</td>
                                <td className="px-6 py-4 text-gray-300">{r.count} чел.</td>
                                <td className="px-6 py-4 text-green-400 font-bold">{r.earned.toLocaleString('ru-RU')} ₽</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

interface UsersPageProps {
  userSearch: string;
  setUserSearch: (s: string) => void;
  setSelectedUser: (u: User) => void;
  setMassActionType: (t: string | null) => void;
}

const UsersPage: React.FC<UsersPageProps> = ({ userSearch, setUserSearch, setSelectedUser, setMassActionType }) => {
    const [statusFilter, setStatusFilter] = useState<'all' | 'Trial' | 'Active' | 'Banned'>('all');
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const [listUsers, setListUsers] = useState<User[]>([]);
    const [totalUsers, setTotalUsers] = useState(0);
    const [page, setPage] = useState(0);
    const [loadingUsers, setLoadingUsers] = useState(false);

    const filteredUsers = listUsers.filter(u => {
        const matchesStatus = statusFilter === 'all' ||
                              (statusFilter === 'Banned' ? u.status === 'Banned' : u.status === statusFilter);
        return matchesStatus;
    });

    useEffect(() => {
        setPage(0);
    }, [userSearch, statusFilter]);

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(async () => {
            setLoadingUsers(true);
            try {
                const params = new URLSearchParams({
                    limit: String(USERS_PAGE_SIZE),
                    offset: String(page * USERS_PAGE_SIZE),
                });
                if (userSearch.trim()) {
                    params.set('search', userSearch.trim());
                }
                const data = await apiFetch(`/panel/users?${params}`);
                if (cancelled) return;
                const raw = data?.users ?? (Array.isArray(data) ? data : []);
                setListUsers(raw.map(mapApiUser));
                setTotalUsers(data?.total ?? raw.length);
            } catch (e) {
                console.error('Failed to load users', e);
                if (!cancelled) {
                    setListUsers([]);
                    setTotalUsers(0);
                }
            } finally {
                if (!cancelled) setLoadingUsers(false);
            }
        }, userSearch.trim() ? 350 : 0);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [userSearch, page]);

    const totalPages = Math.max(1, Math.ceil(totalUsers / USERS_PAGE_SIZE));

    const [showMassMenu, setShowMassMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMassMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div><h2 className="text-2xl font-bold text-white">Пользователи</h2><p className="text-gray-400 mt-1">Управление базой клиентов</p></div>

                {}
                <div className="relative" ref={menuRef}>
                    <button onClick={() => setShowMassMenu(!showMassMenu)} className="flex items-center px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-900/20 transition-all">
                        <Layers size={18} className="mr-2" /> Массовые действия <ChevronDown size={16} className={`ml-2 transition-transform ${showMassMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showMassMenu && (
                        <div className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                            <button onClick={() => { setMassActionType('MASS_ADD_DAYS'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <Calendar size={16} className="mr-2 text-blue-400" /> Добавить дни всем
                            </button>
                            <button onClick={() => { setMassActionType('MASS_BAN'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <Ban size={16} className="mr-2 text-red-400" /> Забанить всех
                            </button>
                            <button onClick={() => { setMassActionType('MASS_UNBAN'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <CheckCircle size={16} className="mr-2 text-green-400" /> Разбанить всех
                            </button>
                            <button onClick={() => { setMassActionType('MASS_RESET_TRIAL'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <RefreshCw size={16} className="mr-2 text-yellow-400" /> Сбросить пробный период
                            </button>
                            <button onClick={() => { setMassActionType('MASS_DELETE_KEYS'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <Trash2 size={16} className="mr-2 text-red-400" /> Удалить все ключи
                            </button>
                            <button onClick={() => { setMassActionType('MASS_SET_PARTNER'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <UserPlus size={16} className="mr-2 text-indigo-400" /> Сделать партнерами
                            </button>
                            <button onClick={() => { setMassActionType('MASS_REMOVE_PARTNER'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center">
                                <UserMinus size={16} className="mr-2 text-gray-400" /> Убрать партнерство
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex space-x-4">
                <div className="relative flex-grow"><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-4 w-4 text-gray-500" /></div><input type="text" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="block w-full pl-10 pr-3 py-3 bg-gray-900 border border-gray-700 rounded-xl leading-5 text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Поиск по имени, username или ID..." /></div>
                <div className="relative">
                    <button onClick={() => setShowFilterMenu(!showFilterMenu)} className={`px-4 py-3 bg-gray-900 border rounded-xl text-gray-300 hover:bg-gray-800 transition-colors flex items-center ${statusFilter !== 'all' ? 'border-blue-500 text-blue-400' : 'border-gray-700'}`}>
                        <Filter size={18} className="mr-2" />
                        {statusFilter === 'all' ? 'Фильтр' : statusFilter === 'Trial' ? 'Триал' : statusFilter === 'Active' ? 'Активные' : 'Забаненные'}
                    </button>
                    {showFilterMenu && (
                        <div className="absolute top-full right-0 mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden min-w-[150px]">
                            {[{v: 'all', l: 'Все'}, {v: 'Trial', l: 'Триал'}, {v: 'Active', l: 'Активные'}, {v: 'Banned', l: 'Забаненные'}].map(opt => (
                                <button key={opt.v} onClick={() => { setStatusFilter(opt.v as any); setShowFilterMenu(false); }} className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-800 transition-colors ${statusFilter === opt.v ? 'text-blue-400 bg-blue-600/10' : 'text-gray-300'}`}>{opt.l}</button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <div className="flex items-center justify-between text-sm text-gray-500 px-1">
                <span>
                    {userSearch.trim()
                        ? `Найдено: ${totalUsers.toLocaleString('ru-RU')}`
                        : `Всего в базе: ${totalUsers.toLocaleString('ru-RU')}`}
                    {loadingUsers && <Loader size={14} className="inline ml-2 animate-spin" />}
                </span>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        disabled={page <= 0 || loadingUsers}
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 disabled:opacity-40 hover:bg-gray-700"
                    >
                        Назад
                    </button>
                    <span className="text-gray-400">{page + 1} / {totalPages}</span>
                    <button
                        type="button"
                        disabled={page >= totalPages - 1 || loadingUsers}
                        onClick={() => setPage(p => p + 1)}
                        className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 disabled:opacity-40 hover:bg-gray-700"
                    >
                        Вперёд
                    </button>
                </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider"><th className="px-6 py-4">Пользователь</th><th className="px-6 py-4">Реф. баланс</th><th className="px-6 py-4">Подписка</th><th className="px-6 py-4">Партнер</th><th className="px-6 py-4 text-right">Действие</th></tr></thead>
                        <tbody className="divide-y divide-gray-800">
                            {!loadingUsers && filteredUsers.length === 0 && (
                                <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Пользователи не найдены</td></tr>
                            )}
                            {filteredUsers.map((user) => (
                                <tr key={user.id} onClick={() => setSelectedUser(user)} className="hover:bg-gray-800/30 cursor-pointer group">
                                    <td className="px-6 py-4 text-sm font-medium text-white flex items-center"><div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center mr-3 text-xs font-bold text-gray-300">{user.username.substring(0, 2).toUpperCase()}</div>{user.username}</td>
                                    <td className="px-6 py-4 text-sm text-white font-bold">
                                      {user.partnerBalance} ₽
                                      {user.referralWithdrawBlocked && (
                                        <span className="ml-2 text-[10px] text-red-400 font-normal">вывод off</span>
                                      )}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-400">{user.paidUntil}</td>
                                    <td className="px-6 py-4 text-sm">{user.isPartner ? <span className="text-indigo-400 bg-indigo-400/10 px-2 py-0.5 rounded text-xs border border-indigo-400/20">Да</span> : <span className="text-gray-600">-</span>}</td>
                                    <td className="px-6 py-4 text-right"><button className="text-gray-500 hover:text-white p-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"><Settings size={16} /></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

interface KeysPageProps {
  keys: KeyItem[];
  keySearch: string;
  setKeySearch: (s: string) => void;
  setIsCreateKeyOpen: (b: boolean) => void;
  setEditingKey: (k: KeyItem | null) => void;
}

const KeysPage: React.FC<KeysPageProps> = ({ keys, keySearch, setKeySearch, setIsCreateKeyOpen, setEditingKey }) => {
    const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Expired' | 'Banned'>('all');
    const [showFilterMenu, setShowFilterMenu] = useState(false);

    const filteredKeys = keys.filter(k => {
        const matchesSearch = k.key.toLowerCase().includes(keySearch.toLowerCase()) || k.user.toLowerCase().includes(keySearch.toLowerCase());
        const matchesStatus = statusFilter === 'all' || k.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 className="text-2xl font-bold text-white">Ключи</h2><p className="text-gray-400 mt-1">Управление подписками VLESS/Vmess</p></div><button onClick={() => setIsCreateKeyOpen(true)} className="flex items-center px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-900/20 transition-all"><Plus size={18} className="mr-2" />Создать</button></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6"><StatCard title="Всего ключей" value={keys.length} icon={Key} color="blue" /><StatCard title="Истёкшие" value={keys.filter(k => k.status === 'Expired').length} icon={Clock} color="orange" /><StatCard title="Заблокированные" value={keys.filter(k => k.status === 'Banned').length} icon={Ban} color="red" /></div>
            <div className="flex space-x-4">
                <div className="relative flex-grow"><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-4 w-4 text-gray-500" /></div><input type="text" value={keySearch} onChange={e => setKeySearch(e.target.value)} className="block w-full pl-10 pr-3 py-3 bg-gray-900 border border-gray-700 rounded-xl leading-5 text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Поиск по ключу, пользователю..." /></div>
                <div className="relative">
                    <button onClick={() => setShowFilterMenu(!showFilterMenu)} className={`px-4 py-3 bg-gray-900 border rounded-xl text-gray-300 hover:bg-gray-800 transition-colors flex items-center ${statusFilter !== 'all' ? 'border-blue-500 text-blue-400' : 'border-gray-700'}`}>
                        <Filter size={18} className="mr-2" />
                        {statusFilter === 'all' ? 'Фильтр' : statusFilter === 'Active' ? 'Активные' : statusFilter === 'Expired' ? 'Истёкшие' : 'Забаненные'}
                    </button>
                    {showFilterMenu && (
                        <div className="absolute top-full right-0 mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden min-w-[150px]">
                            {[{v: 'all', l: 'Все'}, {v: 'Active', l: 'Активные'}, {v: 'Expired', l: 'Истёкшие'}, {v: 'Banned', l: 'Забаненные'}].map(opt => (
                                <button key={opt.v} onClick={() => { setStatusFilter(opt.v as any); setShowFilterMenu(false); }} className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-800 transition-colors ${statusFilter === opt.v ? 'text-blue-400 bg-blue-600/10' : 'text-gray-300'}`}>{opt.l}</button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
             <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider"><th className="px-6 py-4">ID / Ключ</th><th className="px-6 py-4">Пользователь</th><th className="px-6 py-4">Статус</th><th className="px-6 py-4">Осталось</th><th className="px-6 py-4">Трафик</th><th className="px-6 py-4">Устр.</th><th className="px-6 py-4 text-right"></th></tr></thead>
                        <tbody className="divide-y divide-gray-800">
                            {filteredKeys.map((k) => (
                                <tr key={k.id} onClick={() => setEditingKey(k)} className="hover:bg-gray-800/30 transition-colors group cursor-pointer relative">
                                    <td className="px-6 py-4"><div className="text-sm font-mono text-white">#{k.id}</div><div className="text-xs text-gray-500 truncate w-32 font-mono mt-0.5 opacity-70">{k.key}</div></td>
                                    <td className="px-6 py-4 text-sm text-blue-400 font-medium">{k.user}</td><td className="px-6 py-4"><span className={`px-2 py-1 rounded text-xs font-medium border ${k.status === 'Active' ? 'bg-green-500/10 text-green-400 border-green-500/20' : k.status === 'Expired' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>{k.status}</span></td>
                                    <td className="px-6 py-4 text-sm text-gray-300">{k.expiry > 0 ? `${k.expiry} дн.` : 'Истёк'}</td>
                                    <td className="px-6 py-4"><div className="text-xs text-gray-400 mb-1">{(k.trafficUsed / (1024**3)).toFixed(1)} / {k.trafficLimit > 0 ? (k.trafficLimit / (1024**3)).toFixed(0) : '∞'} GB</div><div className="w-24 bg-gray-800 rounded-full h-1.5"><div className={`h-1.5 rounded-full ${k.trafficLimit > 0 && k.trafficUsed/k.trafficLimit > 0.9 ? 'bg-red-500' : k.trafficLimit > 0 && k.trafficUsed/k.trafficLimit > 0.7 ? 'bg-yellow-500' : 'bg-blue-500'}`} style={{ width: `${k.trafficLimit > 0 ? Math.min(100, (k.trafficUsed/k.trafficLimit)*100) : 0}%` }}></div></div></td><td className="px-6 py-4 text-sm text-gray-400 text-center">{k.devicesUsed}/{k.devicesLimit}</td>
                                    <td className="px-6 py-4 text-right"><div className="p-2 bg-gray-800 rounded-lg text-gray-500 group-hover:bg-blue-600 group-hover:text-white transition-colors inline-block"><Edit2 size={16} /></div></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

interface MailingPageProps {
  onToast: (title: string, msg: string, type: ToastType) => void;
}

const MailingPage: React.FC<MailingPageProps> = ({ onToast }) => {
    const [stats, setStats] = useState<{
        totalSent: number;
    } | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [message, setMessage] = useState('');
    const [buttonType, setButtonType] = useState<string>('');
    const [buttonValue, setButtonValue] = useState('');
    const [targetUsers, setTargetUsers] = useState('all');
    const [isSending, setIsSending] = useState(false);
    const [sendProgress, setSendProgress] = useState(0);
    const [sendDoneText, setSendDoneText] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/mailing/stats');
                if (data) {
                    setStats(data);
                }
            } catch (e) {
                console.error('Failed to load mailing stats', e);
            }
        })();

        (async () => {
            try {
                const data = await apiFetch('/panel/mailing/history');
                if (Array.isArray(data)) {
                    setHistory(data);
                }
            } catch (e) {
                console.error('Failed to load mailing history', e);
            }
        })();
    }, []);

    const handleSend = async () => {
        if (!message.trim()) {
            onToast('Ошибка', 'Введите текст сообщения', 'error');
            return;
        }
        if (!window.confirm(`Отправить рассылку в сегмент "${targetUsers}"?`)) {
            return;
        }
        setIsSending(true);
        setSendProgress(2);
        setSendDoneText('');
        const t = setInterval(() => {
            setSendProgress(p => Math.min(95, p + Math.max(1, Math.round((100 - p) / 12))));
        }, 220);
        try {
            const payload: any = {
                message,
                target_users: targetUsers,
                title: message.substring(0, 50)
            };
            if (buttonType && buttonValue) {
                payload.button_type = buttonType;
                payload.button_value = buttonValue;
            }
            const sendRes = await apiFetch('/panel/mailing', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            clearInterval(t);
            setSendProgress(100);
            setSendDoneText(`${sendRes?.sent ?? 0}/${sendRes?.total ?? sendRes?.sent ?? 0}`);
            onToast('Рассылка', 'Сообщения поставлены в очередь', 'success');
            setMessage('');
            setButtonType('');
            setButtonValue('');

            const statsData = await apiFetch('/panel/mailing/stats');
            if (statsData) setStats(statsData);
            const historyData = await apiFetch('/panel/mailing/history');
            if (Array.isArray(historyData)) setHistory(historyData);
        } catch (e: any) {
            clearInterval(t);
            onToast('Ошибка', 'Не удалось отправить рассылку', 'error');
        } finally {
            setTimeout(() => {
                setIsSending(false);
                setSendProgress(0);
                setSendDoneText('');
            }, 700);
        }
    };

    const handleRecall = async (id: number) => {
        if (!window.confirm('Удалить эту рассылку у всех получателей и из истории?')) return;
        try {
            const res = await apiFetch(`/panel/mailing/${id}/recall`, { method: 'POST' });
            onToast('Рассылка', `Удалено: ${res?.deleted || 0}, ошибки: ${res?.failed || 0}`, 'success');
            const historyData = await apiFetch('/panel/mailing/history');
            if (Array.isArray(historyData)) setHistory(historyData);
            const statsData = await apiFetch('/panel/mailing/stats');
            if (statsData) setStats(statsData);
        } catch {
            onToast('Ошибка', 'Не удалось удалить рассылку', 'error');
        }
    };

    const buttonTypes = [
        { value: '', label: 'Без кнопки' },
        { value: 'external_link', label: 'Сторонняя ссылка' },
        { value: 'open_miniapp', label: 'Открыть мини-приложение' },
        { value: 'activate_promo', label: 'Активировать промокод' },
    ];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 className="text-2xl font-bold text-white">Рассылка</h2><p className="text-gray-400 mt-1">Массовая отправка сообщений пользователям</p></div></div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard
                    title="Отправлено рассылок"
                    value={stats ? stats.totalSent.toLocaleString('ru-RU') : '—'}
                    icon={Send}
                    color="blue"
                />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                        <h3 className="text-lg font-bold text-gray-200 mb-4 flex items-center"><Plus size={20} className="mr-2 text-blue-500"/> Новая рассылка</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Текст сообщения</label>
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl p-4 text-white focus:outline-none focus:border-blue-500 h-32 resize-none"
                                    placeholder="Введите текст рассылки... Поддерживается Markdown"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm text-gray-400 mb-1.5 block">Тип кнопки</label>
                                    <select
                                        value={buttonType}
                                        onChange={(e) => setButtonType(e.target.value)}
                                        className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500"
                                    >
                                        {buttonTypes.map(bt => (
                                            <option key={bt.value} value={bt.value}>{bt.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-sm text-gray-400 mb-1.5 block">Значение</label>
                                    <input
                                        type="text"
                                        value={buttonValue}
                                        onChange={(e) => setButtonValue(e.target.value)}
                                        className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500"
                                        placeholder={buttonType === 'external_link' ? 'https://' : buttonType === 'activate_promo' ? 'PROMOCODE' : buttonType === 'add_balance' ? '100' : 'Введите значение...'}
                                        disabled={!buttonType}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 mb-2 block">Получатели</label>
                                <div className="flex flex-wrap gap-2">
                                    {['all', 'active', 'expired', 'no_subscription'].map(filter => (
                                        <button
                                            key={filter}
                                            onClick={() => setTargetUsers(filter)}
                                            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                                                targetUsers === filter
                                                    ? 'bg-blue-600 text-white border-blue-500'
                                                    : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                                            }`}
                                        >
                                            {filter === 'all' ? 'Все пользователи' :
                                             filter === 'active' ? 'Активные' :
                                             filter === 'expired' ? 'Истекшие' : 'Без подписки'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="pt-2 flex gap-4">
                                <button
                                    onClick={handleSend}
                                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-colors flex justify-center items-center"
                                >
                                    <Send size={18} className="mr-2" /> Отправить
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden flex flex-col max-h-[600px]">
                    <div className="p-5 border-b border-gray-800"><h3 className="text-lg font-bold text-gray-200">История</h3></div>
                    <div className="overflow-y-auto custom-scrollbar flex-1">
                        {history.length === 0 ? (
                            <div className="p-4 text-center text-gray-500">Нет рассылок</div>
                        ) : (
                            history.map((item) => (
                                <div key={item.id} className="p-4 border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-medium text-white line-clamp-1">{item.title || 'Без названия'}</span>
                                        <span className="text-xs text-gray-500 whitespace-nowrap ml-2">{item.date}</span>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap break-words max-h-24 overflow-auto custom-scrollbar">{item.message_text || ''}</p>
                                    <div className="flex justify-between items-center mt-2">
                                        <span className={`text-xs px-2 py-0.5 rounded border ${
                                            item.status === 'Completed'
                                                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                                : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                        }`}>
                                            {item.status === 'Completed' ? 'Отправлено' : item.status}
                                        </span>
                                        <span className="text-xs text-gray-400 flex items-center">
                                            <Users size={12} className="mr-1"/> {item.sent_count || 0}
                                        </span>
                                    </div>
                                    <button onClick={() => handleRecall(item.id)} className="mt-3 w-full py-2 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-300 rounded-lg border border-red-500/20">Удалить у всех и из истории</button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
            {isSending && (
                <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-200">
                        <h4 className="text-white font-bold mb-3">Идет рассылка...</h4>
                        <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${sendProgress}%` }} />
                        </div>
                        <div className="mt-2 text-sm text-gray-300">
                            {sendDoneText ? `Отправлено: ${sendDoneText}` : `Прогресс: ${sendProgress}%`}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

interface TariffsPageProps {
  promos: Promo[];
  setPromos: React.Dispatch<React.SetStateAction<Promo[]>>;
  plans: Plan[];
  setPlans: React.Dispatch<React.SetStateAction<Plan[]>>;
  onToast: (title: string, msg: string, type: ToastType) => void;
}

const TariffsPage: React.FC<TariffsPageProps> = ({ promos, setPromos, plans, setPlans, onToast }) => {
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div><h2 className="text-2xl font-bold text-white">Тарифы</h2><p className="text-gray-400 mt-1">Управление тарифными планами и пробным периодом</p></div>
            </div>
            <TariffsPlansPage onToast={onToast} />
        </div>
    );
};

const PromocodesPage: React.FC<{ promos: Promo[]; setPromos: React.Dispatch<React.SetStateAction<Promo[]>>; onToast: (title: string, msg: string, type: ToastType) => void; }> = ({ promos, setPromos, onToast }) => {
    const [newPromo, setNewPromo] = useState<{ code: string; type: Promo['type']; value: string; limit: string; expires: string }>({
        code: '',
        type: 'balance',
        value: '',
        limit: '',
        expires: '',
    });

    const handleCreatePromo = async () => {
        if (!newPromo.code || !newPromo.value) {
            onToast('Ошибка', 'Заполните код и значение промокода', 'error');
            return;
        }
        try {
            const payload: any = {
                code: newPromo.code.toUpperCase(),
                type: newPromo.type,
                value: newPromo.value,
                uses_limit: newPromo.limit ? Number(newPromo.limit) : null,
                expires_at: newPromo.expires || null,
                is_active: 1,
            };
            const res = await apiFetch('/panel/promocodes', { method: 'POST', body: JSON.stringify(payload) });
            const p = res?.promocode || payload;
            setPromos(prev => [...prev, {
                id: p.id,
                code: p.code,
                type: p.type,
                value: String(p.value),
                uses: p.uses_count ?? 0,
                limit: p.uses_limit ?? 0,
                expires: p.expires_at ? new Date(p.expires_at).toLocaleDateString('ru-RU') : 'Бессрочно',
            }]);
            setNewPromo({ code: '', type: 'balance', value: '', limit: '', expires: '' });
            onToast('Успех', 'Промокод создан', 'success');
        } catch {
            onToast('Ошибка', 'Не удалось создать промокод', 'error');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div><h2 className="text-2xl font-bold text-white">Промокоды</h2><p className="text-gray-400 mt-1">Отдельное управление промокодами</p></div>
            <PromocodesStats promos={promos} />
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-200 mb-4 flex items-center"><Plus size={20} className="mr-2 text-blue-500" /> Новый промокод</h3>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <input type="text" value={newPromo.code} onChange={e => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono" placeholder="Код" />
                    <select value={newPromo.type} onChange={e => setNewPromo({ ...newPromo, type: e.target.value as Promo['type'] })} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                        <option value="balance">Пополнение баланса</option><option value="discount">Скидка (%)</option><option value="subscription">Подписка (дней)</option>
                    </select>
                    <input type="text" value={newPromo.value} onChange={e => setNewPromo({ ...newPromo, value: e.target.value })} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="Значение" />
                    <input type="number" value={newPromo.limit} onChange={e => setNewPromo({ ...newPromo, limit: e.target.value })} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="Лимит" />
                    <input type="text" value={newPromo.expires} onChange={e => setNewPromo({ ...newPromo, expires: e.target.value })} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="YYYY-MM-DD" />
                </div>
                <div className="flex justify-end mt-4"><button onClick={handleCreatePromo} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-900/20 transition-colors flex items-center"><Save size={18} className="mr-2" /> Создать промокод</button></div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider"><th className="px-6 py-4">Код</th><th className="px-6 py-4">Тип</th><th className="px-6 py-4">Значение</th><th className="px-6 py-4">Исп.</th><th className="px-6 py-4">Срок</th><th className="px-6 py-4 text-right" /></tr></thead>
                        <tbody className="divide-y divide-gray-800">
                            {promos.map((p) => (
                                <tr key={p.id} className="hover:bg-gray-800/30 transition-colors">
                                    <td className="px-6 py-4 text-sm font-mono text-white">{p.code}</td>
                                    <td className="px-6 py-4 text-sm text-gray-300">{p.type === 'balance' ? 'Пополнение' : p.type === 'discount' ? 'Скидка' : 'Подписка'}</td>
                                    <td className="px-6 py-4 text-sm text-green-400 font-bold">{p.value}</td>
                                    <td className="px-6 py-4 text-sm text-gray-400">{p.uses} / {p.limit || '∞'}</td>
                                    <td className="px-6 py-4 text-sm text-gray-400">{p.expires}</td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            type="button"
                                            className="text-red-500 hover:text-red-400 p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                                            onClick={async () => {
                                                if (!window.confirm(`Удалить промокод ${p.code}?`)) return;
                                                try {
                                                    await apiFetch(`/panel/promocodes/${p.id}`, { method: 'DELETE' });
                                                    setPromos(prev => prev.filter(x => x.id !== p.id));
                                                    onToast('Промокод', 'Промокод удален', 'success');
                                                } catch {
                                                    onToast('Ошибка', 'Не удалось удалить промокод', 'error');
                                                }
                                            }}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

interface PublicPagesProps {
    onToast: (title: string, msg: string, type: ToastType) => void;
}

const TariffsPlansPage: React.FC<{ onToast: (title: string, msg: string, type: ToastType) => void }> = ({ onToast }) => {
    const [plans, setPlans] = useState<any[]>([]);
    const [trialHours, setTrialHours] = useState<string>('24');
    const [loading, setLoading] = useState(true);
    const [editingPlan, setEditingPlan] = useState<any | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [plansRes, settingsRes] = await Promise.all([
                apiFetch('/panel/tariffs'),
                apiFetch('/panel/settings')
            ]);
            if (Array.isArray(plansRes)) setPlans(plansRes);
            if (settingsRes?.TRIAL_HOURS) setTrialHours(String(settingsRes.TRIAL_HOURS));
        } catch (e) {
            console.error('Failed to load tariffs', e);
        }
        setLoading(false);
    };

    const handleSavePlan = async (plan: any) => {
        try {
            if (plan.id) {
                await apiFetch(`/panel/tariffs/${plan.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(plan)
                });
            } else {
                await apiFetch('/panel/tariffs', {
                    method: 'POST',
                    body: JSON.stringify(plan)
                });
            }
            onToast('Успех', 'Тариф сохранен', 'success');
            loadData();
            setEditingPlan(null);
        } catch (e) {
            onToast('Ошибка', 'Не удалось сохранить тариф', 'error');
        }
    };

    const handleDeletePlan = async (id: number) => {
        if (!confirm('Удалить тариф?')) return;
        try {
            await apiFetch(`/panel/tariffs/${id}`, { method: 'DELETE' });
            onToast('Успех', 'Тариф удален', 'success');
            loadData();
        } catch (e) {
            onToast('Ошибка', 'Не удалось удалить тариф', 'error');
        }
    };

    const handleSaveTrial = async () => {
        try {
            await apiFetch('/panel/settings', {
                method: 'PUT',
                body: JSON.stringify({ TRIAL_HOURS: trialHours })
            });
            onToast('Успех', 'Пробный период сохранен', 'success');
        } catch (e) {
            onToast('Ошибка', 'Не удалось сохранить настройки', 'error');
        }
    };

    if (loading) {
        return <div className="flex justify-center py-10"><Loader className="animate-spin text-blue-500" size={32} /></div>;
    }

    return (
        <div className="space-y-6">
            {}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-white flex items-center">
                        <Zap size={20} className="mr-2 text-blue-500" /> VPN Тарифы
                    </h3>
                    <button
                        onClick={() => setEditingPlan({ plan_type: 'vpn', name: '', price: 0, duration_days: 30 })}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium flex items-center"
                    >
                        <Plus size={16} className="mr-1" /> Добавить
                    </button>
                </div>
                <div className="grid gap-4">
                    {plans.filter(p => p.plan_type === 'vpn').map(plan => (
                        <div key={plan.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex justify-between items-center">
                            <div>
                                <div className="font-bold text-white">{plan.name}</div>
                                <div className="text-sm text-gray-400">{plan.duration_days} дней</div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="text-xl font-bold text-blue-400">{plan.price} ₽</div>
                                <div className="flex gap-2">
                                    <button onClick={() => setEditingPlan(plan)} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg"><Edit2 size={16} className="text-gray-300" /></button>
                                    <button onClick={() => handleDeletePlan(plan.id)} className="p-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg"><Trash2 size={16} className="text-red-400" /></button>
                                </div>
                            </div>
                        </div>
                    ))}
                    {plans.filter(p => p.plan_type === 'vpn').length === 0 && (
                        <div className="text-center text-gray-500 py-8">Нет VPN тарифов</div>
                    )}
                </div>
            </div>

            {}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white flex items-center mb-6">
                    <Clock size={20} className="mr-2 text-purple-500" /> Пробный период
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                    <div>
                        <label className="text-sm text-gray-400 block mb-2">Длительность триала (часы)</label>
                        <input
                            type="number"
                            min={1}
                            value={trialHours}
                            onChange={e => setTrialHours(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                        />
                    </div>
                    <p className="text-sm text-gray-500">Используется при создании пробной подписки новым пользователям.</p>
                </div>
                <button
                    onClick={handleSaveTrial}
                    className="mt-4 px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium"
                >
                    Сохранить пробный период
                </button>
            </div>

            {}
            {editingPlan && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md">
                        <h3 className="text-xl font-bold text-white mb-6">{editingPlan.id ? 'Редактировать' : 'Новый'} тариф</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm text-gray-400 block mb-2">Название</label>
                                <input
                                    type="text"
                                    value={editingPlan.name}
                                    onChange={e => setEditingPlan({ ...editingPlan, name: e.target.value })}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                                    placeholder="1 месяц"
                                />
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 block mb-2">Цена (₽)</label>
                                <input
                                    type="number"
                                    value={editingPlan.price}
                                    onChange={e => setEditingPlan({ ...editingPlan, price: Number(e.target.value) })}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                                />
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 block mb-2">Длительность (дней)</label>
                                <input
                                    type="number"
                                    value={editingPlan.duration_days}
                                    onChange={e => setEditingPlan({ ...editingPlan, duration_days: Number(e.target.value) })}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setEditingPlan(null)}
                                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
                            >
                                Отмена
                            </button>
                            <button
                                onClick={() => handleSavePlan(editingPlan)}
                                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
                            >
                                Сохранить
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const PromocodesStats: React.FC<{ promos: Promo[] }> = ({ promos }) => {
    const [stats, setStats] = useState<{ total: number; totalUses: number; activeCount: number } | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/promocodes/stats');
                if (data) {
                    setStats(data);
                }
            } catch (e) {
                console.error('Failed to load promocodes stats', e);
            }
        })();
    }, []);

    const totalBonus = promos.reduce((sum, p) => {
        if (p.type === 'balance') return sum + (Number(p.value) * p.uses);
        return sum;
    }, 0);

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard
                title="Активных кодов"
                value={stats ? stats.activeCount : promos.length}
                icon={Tag}
                color="green"
            />
            <StatCard
                title="Использований"
                value={stats ? stats.totalUses.toLocaleString('ru-RU') : '0'}
                icon={Users}
                color="blue"
            />
            <StatCard
                title="Сумма бонусов"
                value={`${totalBonus.toLocaleString('ru-RU')} ₽`}
                icon={Gift}
                color="purple"
            />
        </div>
    );
};

const AutoDiscountsPage: React.FC<{ onToast: (title: string, msg: string, type: ToastType) => void }> = ({ onToast }) => {
    const [discounts, setDiscounts] = useState<any[]>([]);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newDiscount, setNewDiscount] = useState({
        name: '',
        condition_type: 'payment_amount',
        condition_value: '',
        discount_type: 'percent',
        discount_value: '',
        is_active: true
    });

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/auto-discounts');
                if (Array.isArray(data)) {
                    setDiscounts(data);
                }
            } catch (e) {
                console.error('Failed to load auto discounts', e);
            }
        })();
    }, []);

    const handleCreate = async () => {
        if (!newDiscount.name || !newDiscount.condition_value || !newDiscount.discount_value) {
            onToast('Ошибка', 'Заполните все поля', 'error');
            return;
        }
        try {
            await apiFetch('/panel/auto-discounts', {
                method: 'POST',
                body: JSON.stringify(newDiscount),
            });
            onToast('Успех', 'Правило создано', 'success');
            setShowCreateModal(false);
            setNewDiscount({ name: '', condition_type: 'payment_amount', condition_value: '', discount_type: 'percent', discount_value: '', is_active: true });
            const data = await apiFetch('/panel/auto-discounts');
            if (Array.isArray(data)) setDiscounts(data);
        } catch (e: any) {
            onToast('Ошибка', 'Не удалось создать правило', 'error');
        }
    };

    return (
        <>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white">Автоматические правила</h3>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="text-blue-400 text-sm hover:underline font-medium"
                    >
                        + Добавить правило
                    </button>
                </div>
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-gray-800/50 text-gray-400 text-xs uppercase">
                            <th className="px-6 py-4">Название</th>
                            <th className="px-6 py-4">Условие</th>
                            <th className="px-6 py-4">Бонус</th>
                            <th className="px-6 py-4">Статус</th>
                            <th className="px-6 py-4 text-right"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {discounts.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                                    Нет правил. Создайте первое правило.
                                </td>
                            </tr>
                        ) : (
                            discounts.map((d) => (
                                <tr key={d.id}>
                                    <td className="px-6 py-4 text-white font-medium">{d.name}</td>
                                    <td className="px-6 py-4 text-gray-400 text-sm">
                                        {d.condition_type === 'payment_amount' && `Пополнение > ${d.condition_value}₽`}
                                        {d.condition_type === 'payment_method' && `Оплата через ${d.condition_value}`}
                                        {d.condition_type === 'plan_type' && `Покупка тарифа "${d.condition_value}"`}
                                    </td>
                                    <td className="px-6 py-4 text-green-400 font-bold">
                                        {d.discount_type === 'percent' ? `+${d.discount_value}%` : `+${d.discount_value}₽`}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-0.5 rounded text-xs border ${
                                            d.is_active
                                                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                                : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                        }`}>
                                            {d.is_active ? 'Активна' : 'Неактивна'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={async () => {
                                                try {
                                                    await apiFetch(`/panel/auto-discounts/${d.id}`, { method: 'DELETE' });
                                                    onToast('Успех', 'Правило удалено', 'success');
                                                    const data = await apiFetch('/panel/auto-discounts');
                                                    if (Array.isArray(data)) setDiscounts(data);
                                                } catch (e) {
                                                    onToast('Ошибка', 'Не удалось удалить правило', 'error');
                                                }
                                            }}
                                            className="text-red-500 hover:text-red-400"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {showCreateModal && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={() => setShowCreateModal(false)}>
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl relative" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-gray-800 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-white">Создать правило</h3>
                            <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-white"><X size={24} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Название</label>
                                <input
                                    type="text"
                                    value={newDiscount.name}
                                    onChange={e => setNewDiscount({ ...newDiscount, name: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white"
                                    placeholder="Бонус за крипту"
                                />
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Тип условия</label>
                                <select
                                    value={newDiscount.condition_type}
                                    onChange={e => setNewDiscount({ ...newDiscount, condition_type: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white"
                                >
                                    <option value="payment_amount">Сумма пополнения</option>
                                    <option value="payment_method">Способ оплаты</option>
                                    <option value="plan_type">Тип тарифа</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Значение условия</label>
                                <input
                                    type="text"
                                    value={newDiscount.condition_value}
                                    onChange={e => setNewDiscount({ ...newDiscount, condition_value: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white"
                                    placeholder={newDiscount.condition_type === 'payment_amount' ? '1000' : newDiscount.condition_type === 'payment_method' ? 'crypto' : '1 год'}
                                />
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Тип бонуса</label>
                                <select
                                    value={newDiscount.discount_type}
                                    onChange={e => setNewDiscount({ ...newDiscount, discount_type: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white"
                                >
                                    <option value="percent">Процент (%)</option>
                                    <option value="fixed">Фиксированная сумма (₽)</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Значение бонуса</label>
                                <input
                                    type="text"
                                    value={newDiscount.discount_value}
                                    onChange={e => setNewDiscount({ ...newDiscount, discount_value: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white"
                                    placeholder="10"
                                />
                            </div>
                        </div>
                        <div className="p-5 border-t border-gray-800">
                            <button onClick={handleCreate} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold">
                                Создать правило
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

const PublicPages: React.FC<PublicPagesProps> = ({ onToast }) => {
    const [activeTab, setActiveTab] = useState<'offer' | 'privacy'>('offer');
    const [content, setContent] = useState('');
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/public-pages');
                if (data) {
                    setContent(data[activeTab]?.content || '');
                    setLastUpdated(data[activeTab]?.updated_at || null);
                }
            } catch (e) {
                console.error('Failed to load public pages', e);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/public-pages');
                if (data && data[activeTab]) {
                    setContent(data[activeTab].content || '');
                    setLastUpdated(data[activeTab].updated_at || null);
                }
            } catch (e) {
                console.error('Failed to load public page', e);
            }
        })();
    }, [activeTab]);

    const handleSave = async () => {
        try {
            await apiFetch(`/panel/public-pages/${activeTab}`, {
                method: 'PUT',
                body: JSON.stringify({ content }),
            });
            onToast('Сохранено', 'Документ успешно обновлен и синхронизирован с мини-приложением', 'success');
            setLastUpdated(new Date().toISOString());
        } catch (e) {
            onToast('Ошибка', 'Не удалось сохранить документ', 'error');
        }
    };

    if (loading) {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-center h-64"><Loader className="animate-spin text-blue-500" size={32} /></div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div><h2 className="text-2xl font-bold text-white">Публичные страницы</h2><p className="text-gray-400 mt-1">Редактирование юридических документов</p></div>
                <div className="flex bg-gray-900 border border-gray-800 rounded-xl p-1">
                    <button onClick={() => setActiveTab('offer')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'offer' ? 'bg-gray-800 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>Договор оферты</button>
                    <button onClick={() => setActiveTab('privacy')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'privacy' ? 'bg-gray-800 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>Политика конфиденциальности</button>
                </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col h-[calc(100vh-240px)]">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-200 flex items-center">
                        {activeTab === 'offer' ? <FileTextIcon size={20} className="mr-2 text-blue-500"/> : <Shield size={20} className="mr-2 text-green-500"/>}
                        {activeTab === 'offer' ? 'Редактор оферты' : 'Редактор политики'}
                    </h3>
                    <div className="text-xs text-gray-500 flex items-center">
                        <Clock size={12} className="mr-1"/>
                        Последнее сохранение: {lastUpdated ? new Date(lastUpdated).toLocaleString('ru-RU') : 'Никогда'}
                    </div>
                </div>
                <textarea
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    className="flex-1 w-full bg-gray-950 border border-gray-700 rounded-xl p-6 text-gray-300 font-mono text-sm leading-relaxed focus:outline-none focus:border-blue-500 resize-none mb-4"
                    placeholder={activeTab === 'offer' ? "# Договор оферты\n\n1. Общие положения..." : "# Политика конфиденциальности\n\n1. Сбор данных..."}
                />
                <div className="flex justify-end">
                    <button onClick={handleSave} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-900/20 transition-all flex items-center">
                        <FileCheck size={18} className="mr-2" /> Сохранить изменения
                    </button>
                </div>
            </div>
        </div>
    );
};

const SubscriptionSettingsTab: React.FC<{ onToast: (title: string, msg: string, type: ToastType) => void }> = ({ onToast }) => {
    const [squads, setSquads] = useState<any[]>([]);
    const [vpnSquads, setVpnSquads] = useState<string[]>([]);
    const [whitelistSquads, setWhitelistSquads] = useState<string[]>([]);
    const [trialEnabled, setTrialEnabled] = useState(true);
    const [trialHours, setTrialHours] = useState('24');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {

            const squadsData = await apiFetch('/panel/remnawave/squads');
            if (Array.isArray(squadsData)) {
                setSquads(squadsData);
            }

            const defaultSquadsData = await apiFetch('/panel/default-squads');
            if (defaultSquadsData) {
                if (Array.isArray(defaultSquadsData.vpn_squads)) {
                    setVpnSquads(defaultSquadsData.vpn_squads);
                }
                if (Array.isArray(defaultSquadsData.whitelist_squads)) {
                    setWhitelistSquads(defaultSquadsData.whitelist_squads);
                }
            }
        } catch (e) {
            console.error('Failed to load squads:', e);
            onToast('Предупреждение', 'Не удалось загрузить сквады из Remnawave', 'info');
        }
        setLoading(false);
    };

    const toggleSquad = (uuid: string, type: 'vpn' | 'whitelist') => {
        if (type === 'vpn') {
            setVpnSquads(prev =>
                prev.includes(uuid) ? prev.filter(s => s !== uuid) : [...prev, uuid]
            );
        } else {
            setWhitelistSquads(prev =>
                prev.includes(uuid) ? prev.filter(s => s !== uuid) : [...prev, uuid]
            );
        }
    };

    const saveSquads = async () => {
        setSaving(true);
        try {
            await apiFetch('/panel/default-squads', {
                method: 'PUT',
                body: JSON.stringify({
                    vpn_squads: vpnSquads,
                    whitelist_squads: whitelistSquads
                })
            });
            onToast('Успешно', 'Сквады по умолчанию сохранены', 'success');
        } catch (e) {
            console.error('Failed to save default squads:', e);
            onToast('Ошибка', 'Не удалось сохранить сквады', 'error');
        }
        setSaving(false);
    };

    const syncWithRemnawave = async () => {
        setSyncing(true);
        try {
            const result = await apiFetch('/panel/remnawave/sync', { method: 'POST' });
            if (result.success) {
                onToast('Синхронизация', `Удалено ключей: ${result.deleted_keys}`, 'success');
            } else {
                onToast('Ошибка', result.error || 'Ошибка синхронизации', 'error');
            }
        } catch (e) {
            console.error('Failed to sync with Remnawave:', e);
            onToast('Ошибка', 'Не удалось синхронизировать с Remnawave', 'error');
        }
        setSyncing(false);
    };

    const SquadSelector = ({ title, description, selectedSquads, type, color }: {
        title: string, description: string, selectedSquads: string[], type: 'vpn' | 'whitelist', color: string
    }) => (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
            <p className="text-sm text-gray-400 mb-4">{description}</p>
            {loading ? (
                <div className="flex items-center justify-center py-4">
                    <Loader className="animate-spin text-blue-500" size={20} />
                    <span className="ml-2 text-gray-400">Загрузка...</span>
                </div>
            ) : squads.length === 0 ? (
                <div className="p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-xl text-yellow-400 text-sm">
                    Сквады не найдены
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {squads.map(sq => (
                        <label
                            key={sq.uuid}
                            className={`flex items-center space-x-3 px-3 py-2 rounded-xl border cursor-pointer transition-all ${
                                selectedSquads.includes(sq.uuid)
                                    ? `bg-${color}-600/20 border-${color}-500 shadow-lg shadow-${color}-900/20`
                                    : 'bg-gray-950 border-gray-700 hover:border-gray-600'
                            }`}
                            style={selectedSquads.includes(sq.uuid) ? {
                                backgroundColor: color === 'blue' ? 'rgba(37, 99, 235, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                                borderColor: color === 'blue' ? '#3b82f6' : '#22c55e'
                            } : {}}
                            onClick={() => toggleSquad(sq.uuid, type)}
                        >
                            <input
                                type="checkbox"
                                checked={selectedSquads.includes(sq.uuid)}
                                onChange={() => {}}
                                className="w-4 h-4 rounded bg-gray-800 border-gray-600 cursor-pointer"
                            />
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-gray-200 block truncate">{sq.name}</span>
                                <span className="text-xs text-gray-500">{sq.members_count || 0} участников</span>
                            </div>
                        </label>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-6 border-b border-gray-800 pb-4">Пробный период</h3>
                <div className="space-y-6">
                    <div className="flex justify-between items-center p-4 bg-gray-950 rounded-xl border border-gray-800">
                        <span className="text-gray-300 font-medium">Включить пробный период</span>
                        <button onClick={() => setTrialEnabled(!trialEnabled)} className={`w-12 h-6 rounded-full p-1 transition-colors relative ${trialEnabled ? 'bg-blue-600' : 'bg-gray-700'}`}>
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${trialEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">Длительность (часов)</label>
                        <input
                            type="number"
                            value={trialHours}
                            onChange={e => setTrialHours(e.target.value)}
                            className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                            placeholder="24"
                        />
                    </div>
                </div>
            </div>

            <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-white">Балансировщик сквадов</h3>
                <button
                    onClick={saveSquads}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center"
                >
                    {saving && <Loader className="animate-spin mr-2" size={14} />}
                    Сохранить
                </button>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <div className="flex items-start gap-3 p-4 bg-blue-900/20 border border-blue-500/30 rounded-xl mb-4">
                    <Zap className="text-blue-400 shrink-0 mt-0.5" size={20} />
                    <div>
                        <div className="text-blue-400 font-bold mb-1">Автоматический балансировщик</div>
                        <div className="text-blue-300 text-sm">
                            При создании ключа система автоматически выберет сквад с наименьшим количеством пользователей из выбранных ниже.
                            Если сквады не выбраны — будет использован сквад с минимальной нагрузкой из всех доступных.
                        </div>
                    </div>
                </div>
            </div>

            <SquadSelector
                title="🔒 VPN подписка"
                description="Выберите сквады для VPN (балансировщик выберет оптимальный)"
                selectedSquads={vpnSquads}
                type="vpn"
                color="blue"
            />

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-2">Синхронизация с Remnawave</h3>
                <p className="text-sm text-gray-400 mb-4">
                    Удалить из БД бота ключи, которые были удалены из Remnawave
                </p>
                <button
                    onClick={syncWithRemnawave}
                    disabled={syncing}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center"
                >
                    {syncing && <Loader className="animate-spin mr-2" size={14} />}
                    {syncing ? 'Синхронизация...' : '🔄 Синхронизировать'}
                </button>
            </div>
        </div>
    );
};

const BackupSettingsTab: React.FC<{ onToast: (title: string, msg: string, type: ToastType) => void }> = ({ onToast }) => {
    const [backupEnabled, setBackupEnabled] = useState(false);
    const [backupInterval, setBackupInterval] = useState('12');
    const [lastBackup, setLastBackup] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        loadBackupStatus();
    }, []);

    const loadBackupStatus = async () => {
        try {
            const data = await apiFetch('/panel/backups/status');
            if (data) {
                setBackupEnabled(data.enabled || false);
                setBackupInterval(data.interval_hours?.toString() || '12');
                setLastBackup(data.last_backup || null);
            }
        } catch (e) {
            console.error('Failed to load backup status', e);
        }
    };

    const handleCreateBackup = async () => {
        setCreating(true);
        try {
            await apiFetch('/panel/backups/create', { method: 'POST' });
            onToast('Успех', 'Резервная копия создана и отправлена администратору', 'success');
            loadBackupStatus();
        } catch (e) {
            onToast('Ошибка', 'Не удалось создать резервную копию', 'error');
        }
        setCreating(false);
    };

    const handleSaveSettings = async () => {
        try {
            await apiFetch('/panel/backups/settings', {
                method: 'PUT',
                body: JSON.stringify({ enabled: backupEnabled, interval_hours: parseInt(backupInterval) })
            });
            onToast('Успех', 'Настройки бекапов сохранены', 'success');
        } catch (e) {
            onToast('Ошибка', 'Не удалось сохранить настройки', 'error');
        }
    };

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
            <h3 className="text-lg font-bold text-white mb-6 border-b border-gray-800 pb-4">Резервное копирование</h3>
            <div className="space-y-6">
                <div className="flex justify-between items-center p-4 bg-gray-950 rounded-xl border border-gray-800">
                    <div>
                        <span className="text-gray-300 font-medium">Автоматическое резервное копирование</span>
                        <p className="text-xs text-gray-500 mt-1">Бекапы будут создаваться автоматически и отправляться администратору</p>
                    </div>
                    <button onClick={() => setBackupEnabled(!backupEnabled)} className={`w-12 h-6 rounded-full p-1 transition-colors relative ${backupEnabled ? 'bg-blue-600' : 'bg-gray-700'}`}>
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${backupEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Частота создания бэкапов (в часах)</label>
                    <input
                        type="number"
                        value={backupInterval}
                        onChange={e => setBackupInterval(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="12"
                    />
                </div>

                {lastBackup && (
                    <div className="p-3 bg-gray-950 rounded-xl border border-gray-800">
                        <span className="text-gray-500 text-sm">Последний бекап: </span>
                        <span className="text-white text-sm">{new Date(lastBackup).toLocaleString('ru-RU')}</span>
                    </div>
                )}

                <div className="p-4 bg-blue-900/20 border border-blue-500/30 rounded-xl flex items-start">
                    <Cloud className="text-blue-400 mr-3 mt-0.5" size={20} />
                    <div>
                        <h4 className="text-blue-400 font-bold text-sm">Важно</h4>
                        <p className="text-blue-300/80 text-xs mt-1">Бэкапы будут отправляться в личные сообщения администратору в виде архива базы данных.</p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={handleCreateBackup}
                        disabled={creating}
                        className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center"
                    >
                        {creating ? <Loader className="animate-spin mr-2" size={18} /> : <Download size={18} className="mr-2" />}
                        Создать бекап сейчас
                    </button>
                    <button
                        onClick={handleSaveSettings}
                        className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center"
                    >
                        <Save size={18} className="mr-2" />
                        Сохранить настройки
                    </button>
                </div>
            </div>
        </div>
    );
};

interface SquadsPageProps {
    onToast: (title: string, msg: string, type: ToastType) => void;
}

interface SquadConfig {
    id: number;
    squad_uuid: string;
    squad_name: string;
    squad_type: string;
    max_users: number;
    current_users: number;
    is_active: boolean;
    priority: number;
}

const SquadsPage: React.FC<SquadsPageProps> = ({ onToast }) => {
    const [squads, setSquads] = useState<SquadConfig[]>([]);
    const [mapping, setMapping] = useState<{vpn: string[], whitelist: string[], trial: string[]}>({vpn: [], whitelist: [], trial: []});
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [editingSquad, setEditingSquad] = useState<SquadConfig | null>(null);

    const loadSquads = async () => {
        try {
            const data = await apiFetch('/panel/squads');
            if (data) {
                setSquads(data.squads || []);
                setMapping(data.mapping || {vpn: [], whitelist: [], trial: []});
            }
        } catch (e) {
            onToast('Ошибка', 'Не удалось загрузить сквады', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadSquads(); }, []);

    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await apiFetch('/panel/squads/sync', { method: 'POST' });
            if (result?.success) {
                onToast('Успех', `Синхронизировано ${result.count} сквадов`, 'success');
                loadSquads();
            } else {
                onToast('Ошибка', result?.error || 'Ошибка синхронизации', 'error');
            }
        } catch (e) {
            onToast('Ошибка', 'Не удалось синхронизировать', 'error');
        } finally {
            setSyncing(false);
        }
    };

    const handleSaveSquad = async (squad: SquadConfig) => {
        try {
            const result = await apiFetch(`/panel/squads/${squad.squad_uuid}`, {
                method: 'PUT',
                body: JSON.stringify({
                    squad_name: squad.squad_name,
                    squad_type: squad.squad_type,
                    max_users: squad.max_users,
                    priority: squad.priority,
                    is_active: squad.is_active
                })
            });
            if (result?.success) {
                onToast('Успех', 'Сквад обновлён', 'success');
                setEditingSquad(null);
                loadSquads();
            }
        } catch (e) {
            onToast('Ошибка', 'Не удалось сохранить', 'error');
        }
    };

    const handleSaveMapping = async () => {
        try {
            const result = await apiFetch('/panel/squads/mapping', {
                method: 'PUT',
                body: JSON.stringify(mapping)
            });
            if (result?.success) {
                onToast('Успех', 'Привязки сохранены', 'success');
            }
        } catch (e) {
            onToast('Ошибка', 'Не удалось сохранить привязки', 'error');
        }
    };

    const toggleSquadMapping = (type: 'vpn' | 'whitelist' | 'trial', uuid: string) => {
        setMapping(prev => {
            const current = prev[type] || [];
            if (current.includes(uuid)) {
                return { ...prev, [type]: current.filter(u => u !== uuid) };
            } else {
                return { ...prev, [type]: [...current, uuid] };
            }
        });
    };

    const getSquadTypeColor = (type: string) => {
        switch(type) {
            case 'vpn': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            case 'whitelist': return 'bg-green-500/20 text-green-400 border-green-500/30';
            case 'trial': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
            default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center h-64"><Loader className="animate-spin text-blue-500" size={32} /></div>;
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-white">Сквады (Распределение нагрузки)</h1>
                    <p className="text-gray-400 mt-1">Управление распределением пользователей по серверам</p>
                </div>
                <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                >
                    {syncing ? <Loader className="animate-spin mr-2" size={18} /> : <RefreshCw size={18} className="mr-2" />}
                    Синхронизировать с Remnawave
                </button>
            </div>

            {}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {squads.map(squad => (
                    <div
                        key={squad.squad_uuid}
                        className={`bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-all ${!squad.is_active ? 'opacity-50' : ''}`}
                    >
                        <div className="flex justify-between items-start mb-3">
                            <div>
                                <h3 className="font-bold text-white">{squad.squad_name}</h3>
                                <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded border ${getSquadTypeColor(squad.squad_type)}`}>
                                    {squad.squad_type.toUpperCase()}
                                </span>
                            </div>
                            <button
                                onClick={() => setEditingSquad(squad)}
                                className="text-gray-400 hover:text-white p-1"
                            >
                                <Edit2 size={16} />
                            </button>
                        </div>

                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-400">Пользователей:</span>
                                <span className="text-white font-medium">
                                    {squad.current_users} {squad.max_users > 0 && `/ ${squad.max_users}`}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Приоритет:</span>
                                <span className="text-white">{squad.priority}</span>
                            </div>
                            {squad.max_users > 0 && (
                                <div className="w-full bg-gray-800 rounded-full h-2 mt-2">
                                    <div
                                        className="bg-blue-500 h-2 rounded-full transition-all"
                                        style={{ width: `${Math.min(100, (squad.current_users / squad.max_users) * 100)}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {squads.length === 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
                    <Zap size={48} className="mx-auto text-gray-600 mb-4" />
                    <h3 className="text-lg font-bold text-white mb-2">Нет сквадов</h3>
                    <p className="text-gray-400 mb-4">Синхронизируйте сквады с Remnawave</p>
                    <button onClick={handleSync} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                        Синхронизировать
                    </button>
                </div>
            )}

            {}
            {squads.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                    <h2 className="text-lg font-bold text-white mb-4">Привязка сквадов к типам подписок</h2>
                    <p className="text-gray-400 text-sm mb-6">
                        Выберите, на какие сквады будут распределяться пользователи для каждого типа подписки.
                        Система автоматически выберет сквад с наименьшей нагрузкой.
                    </p>

                    <div className="space-y-6">
                        {(['vpn', 'whitelist', 'trial'] as const).map(type => (
                            <div key={type}>
                                <h3 className="font-medium text-white mb-3 flex items-center">
                                    <span className={`w-3 h-3 rounded-full mr-2 ${
                                        type === 'vpn' ? 'bg-blue-500' :
                                        type === 'whitelist' ? 'bg-green-500' : 'bg-yellow-500'
                                    }`} />
                                    {type === 'vpn' ? 'Обычный VPN' : type === 'whitelist' ? 'Обход белых списков' : 'Пробный период'}
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {squads.filter(s => s.is_active).map(squad => (
                                        <button
                                            key={squad.squad_uuid}
                                            onClick={() => toggleSquadMapping(type, squad.squad_uuid)}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                                                mapping[type]?.includes(squad.squad_uuid)
                                                    ? 'bg-blue-600 border-blue-500 text-white'
                                                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                                            }`}
                                        >
                                            {squad.squad_name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={handleSaveMapping}
                        className="mt-6 px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
                    >
                        Сохранить привязки
                    </button>
                </div>
            )}

            {}
            {editingSquad && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setEditingSquad(null)}>
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                        <h2 className="text-xl font-bold text-white mb-4">Редактирование сквада</h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">Название</label>
                                <input
                                    type="text"
                                    value={editingSquad.squad_name}
                                    onChange={e => setEditingSquad({...editingSquad, squad_name: e.target.value})}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">Тип</label>
                                <select
                                    value={editingSquad.squad_type}
                                    onChange={e => setEditingSquad({...editingSquad, squad_type: e.target.value})}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                                >
                                    <option value="vpn">VPN (обычный)</option>
                                    <option value="whitelist">Whitelist (LTE)</option>
                                    <option value="trial">Trial (пробный)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">Макс. пользователей (0 = без лимита)</label>
                                <input
                                    type="number"
                                    value={editingSquad.max_users}
                                    onChange={e => setEditingSquad({...editingSquad, max_users: parseInt(e.target.value) || 0})}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">Приоритет</label>
                                <input
                                    type="number"
                                    value={editingSquad.priority}
                                    onChange={e => setEditingSquad({...editingSquad, priority: parseInt(e.target.value) || 0})}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                                />
                            </div>
                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    checked={editingSquad.is_active}
                                    onChange={e => setEditingSquad({...editingSquad, is_active: e.target.checked})}
                                    className="mr-2"
                                />
                                <label className="text-gray-400">Активен</label>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setEditingSquad(null)}
                                className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 rounded-lg font-medium hover:bg-gray-700 transition-colors"
                            >
                                Отмена
                            </button>
                            <button
                                onClick={() => handleSaveSquad(editingSquad)}
                                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-500 transition-colors"
                            >
                                Сохранить
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

interface ToolsPageProps {
    onToast: (title: string, msg: string, type: ToastType) => void;
}

const ToolsPage: React.FC<ToolsPageProps> = ({ onToast }) => {
    const [exporting, setExporting] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [diagnostics, setDiagnostics] = useState<any>(null);
    const [loadingDiag, setLoadingDiag] = useState(false);

    const exportData = async (type: 'users' | 'keys' | 'transactions') => {
        setExporting(type);
        try {
            const res = await apiFetch(`/panel/export/${type}`);
            if (res && res.data) {
                const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${type}_export_${new Date().toISOString().slice(0,10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                onToast('Успех', `Экспортировано ${res.data.length} записей`, 'success');
            }
        } catch (e: any) {
            onToast('Ошибка', e.message || 'Не удалось экспортировать', 'error');
        } finally {
            setExporting(null);
        }
    };

    const runDiagnostics = async () => {
        setLoadingDiag(true);
        try {
            const res = await apiFetch('/panel/diagnostics');
            setDiagnostics(res);
        } catch (e) {
            onToast('Ошибка', 'Не удалось получить диагностику', 'error');
        } finally {
            setLoadingDiag(false);
        }
    };

    const syncRemnawave = async () => {
        setSyncing(true);
        try {
            const res = await apiFetch('/panel/remnawave/sync', { method: 'POST' });
            if (res?.success) {
                onToast('Успех', `Синхронизировано: ${res.synced || 0} ключей`, 'success');
            }
        } catch (e) {
            onToast('Ошибка', 'Не удалось синхронизировать', 'error');
        } finally {
            setSyncing(false);
        }
    };

    const cleanupExpired = async () => {
        if (!confirm('Удалить все истёкшие ключи старше 30 дней?')) return;
        try {
            const res = await apiFetch('/panel/tools/cleanup-expired', { method: 'POST' });
            onToast('Успех', `Удалено ${res?.deleted || 0} истёкших ключей`, 'success');
        } catch (e) {
            onToast('Ошибка', 'Не удалось выполнить очистку', 'error');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-2xl font-bold text-white">Инструменты</h2>
                <p className="text-gray-400 mt-1">Полезные утилиты для администрирования</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center">
                            <Download size={20} className="text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold">Экспорт данных</h3>
                            <p className="text-gray-500 text-sm">Скачать данные в JSON</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => exportData('users')} disabled={!!exporting} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                            {exporting === 'users' ? <Loader size={14} className="animate-spin mx-auto" /> : 'Пользователи'}
                        </button>
                        <button onClick={() => exportData('keys')} disabled={!!exporting} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                            {exporting === 'keys' ? <Loader size={14} className="animate-spin mx-auto" /> : 'Ключи'}
                        </button>
                        <button onClick={() => exportData('transactions')} disabled={!!exporting} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                            {exporting === 'transactions' ? <Loader size={14} className="animate-spin mx-auto" /> : 'Транзакции'}
                        </button>
                    </div>
                </div>

                {}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-green-600/20 flex items-center justify-center">
                            <RefreshCw size={20} className="text-green-400" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold">Синхронизация</h3>
                            <p className="text-gray-500 text-sm">Обновить данные из Remnawave</p>
                        </div>
                    </div>
                    <button onClick={syncRemnawave} disabled={syncing} className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl font-medium disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                        {syncing ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        {syncing ? 'Синхронизация...' : 'Синхронизировать ключи'}
                    </button>
                </div>

                {}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-red-600/20 flex items-center justify-center">
                            <Trash2 size={20} className="text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold">Очистка данных</h3>
                            <p className="text-gray-500 text-sm">Удалить устаревшие записи</p>
                        </div>
                    </div>
                    <button onClick={cleanupExpired} className="w-full px-4 py-2.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-xl font-medium transition-colors">
                        Удалить истёкшие ключи (30+ дней)
                    </button>
                </div>

                {}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-purple-600/20 flex items-center justify-center">
                            <Activity size={20} className="text-purple-400" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold">Диагностика</h3>
                            <p className="text-gray-500 text-sm">Проверка состояния системы</p>
                        </div>
                    </div>
                    <button onClick={runDiagnostics} disabled={loadingDiag} className="w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                        {loadingDiag ? <Loader size={16} className="animate-spin" /> : <Activity size={16} />}
                        Запустить диагностику
                    </button>
                </div>
            </div>

            {}
            {diagnostics && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <h3 className="text-white font-bold mb-4">Результаты диагностики</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-gray-800 rounded-xl p-4">
                            <div className="text-2xl font-bold text-white">{diagnostics.users_count || 0}</div>
                            <div className="text-gray-400 text-sm">Пользователей</div>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-4">
                            <div className="text-2xl font-bold text-white">{diagnostics.keys_count || 0}</div>
                            <div className="text-gray-400 text-sm">Ключей</div>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-4">
                            <div className="text-2xl font-bold text-white">{diagnostics.active_keys || 0}</div>
                            <div className="text-gray-400 text-sm">Активных ключей</div>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-4">
                            <div className="text-2xl font-bold text-green-400">{diagnostics.remnawave_status || 'N/A'}</div>
                            <div className="text-gray-400 text-sm">Remnawave</div>
                        </div>
                    </div>
                    {diagnostics.issues && diagnostics.issues.length > 0 && (
                        <div className="mt-4 bg-red-600/10 border border-red-500/30 rounded-xl p-4">
                            <div className="text-red-400 font-bold mb-2">Обнаружены проблемы:</div>
                            <ul className="text-red-300 text-sm space-y-1">
                                {diagnostics.issues.map((issue: string, i: number) => (
                                    <li key={i}>• {issue}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

interface SettingsPageProps {
    onToast: (title: string, msg: string, type: ToastType) => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ onToast }) => {
    const [activeTab, setActiveTab] = useState<'general' | 'squads' | 'backups'>('general');
    const [newPassword, setNewPassword] = useState('');

    const handleChangePassword = async () => {
        if (!newPassword || newPassword.length < 8) {
            onToast('Ошибка', 'Минимум 8 символов', 'error');
            return;
        }
        try {
            await apiFetch('/panel/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ new_password: newPassword }),
            });
            setNewPassword('');
            onToast('Успех', 'Пароль панели изменен', 'success');
        } catch {
            onToast('Ошибка', 'Не удалось сменить пароль', 'error');
        }
    };

    const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
            <h3 className="text-lg font-bold text-white mb-6 border-b border-gray-800 pb-4">{title}</h3>
            <div className="space-y-6">{children}</div>
        </div>
    );

    const Input: React.FC<{ label: string; placeholder: string; type?: string; value?: string; onChange?: (v: string) => void }> = ({ label, placeholder, type="text", value, onChange }) => (
        <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">{label}</label>
            <input
                type={type}
                value={value || ''}
                onChange={e => onChange?.(e.target.value)}
                className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                placeholder={placeholder}
            />
        </div>
    );

    return (
        <div className="flex flex-col lg:flex-row gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {}
            <div className="w-full lg:w-64 flex-shrink-0">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden sticky top-24">
                    <div className="p-4 border-b border-gray-800"><h2 className="font-bold text-white">Категории</h2></div>
                    <nav className="p-2 space-y-1">
                        {[{id: 'general', icon: Settings, label: 'Основное'}, {id: 'squads', icon: Zap, label: 'Сквады'}, {id: 'backups', icon: Cloud, label: 'Резервные копии'}].map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`w-full flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-colors ${activeTab === tab.id ? 'bg-blue-600/10 text-blue-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                                <tab.icon size={18} className="mr-3"/> {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>
            </div>

            {}
            <div className="flex-1">
                {activeTab === 'general' && (
                    <Section title="Безопасность панели">
                        <Input
                            label="Новый пароль панели"
                            placeholder="Минимум 8 символов"
                            value={newPassword}
                            onChange={setNewPassword}
                        />
                        <button onClick={handleChangePassword} className="px-6 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-sm font-bold">Сменить пароль</button>
                    </Section>
                )}

                {activeTab === 'squads' && <SquadsPage onToast={onToast} />}

                {activeTab === 'backups' && (
                    <BackupSettingsTab onToast={onToast} />
                )}
            </div>
        </div>
    );
};