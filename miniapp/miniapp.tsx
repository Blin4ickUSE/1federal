import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Smartphone, Monitor, Tv, CreditCard,
  UserPlus, Gift, ChevronLeft, Copy, Trash2,
  CheckCircle, Clock, Globe, Shield, Zap, Plus, Sparkles,
  LogOut, Download, Apple, Command, User, ChevronDown,
  ArrowRight, Frown, BookOpen, ChevronRight, Sliders, X,
  FileText, ExternalLink, MessageCircle
} from 'lucide-react';

declare const importMetaMini: any | undefined;

const rawEnvMini: any =
  (typeof importMetaMini !== 'undefined' && importMetaMini.env) ||
  (typeof (window as any) !== 'undefined' && (window as any).__ENV__) ||
  {};

const API_BASE_URL_MINI: string = rawEnvMini.VITE_API_URL || rawEnvMini.REACT_APP_API_URL || '/api';
const SUPPORT_URL: string = rawEnvMini.VITE_SUPPORT_URL || rawEnvMini.REACT_APP_SUPPORT_URL || 'https://t.me/onefederalbot';
const BOT_USERNAME_MINI: string = rawEnvMini.VITE_BOT_USERNAME || rawEnvMini.REACT_APP_BOT_USERNAME || 'onefederalbot';
const APP_NAME = '1FEDERAL VPN';
const REFERRAL_RUB_PER_USD = 85;
const MIN_REFERRAL_WITHDRAW_RUB = 10;
const MAX_REFERRAL_WITHDRAW_RUB = 5000;
const TON_ADDRESS_RE = /^(EQ|UQ)[A-Za-z0-9_-]{46}$/;
const TON_DNS_RE = /^@?[a-z0-9][a-z0-9._-]{4,124}$/i;

const isTonWithdrawRecipient = (value: string): boolean => {
  const wallet = value.trim();
  if (!wallet || wallet.length > 126) return false;
  if (TON_ADDRESS_RE.test(wallet)) return true;
  const normalized = wallet.startsWith('@') ? `${wallet.slice(1).toLowerCase()}.t.me` : wallet.toLowerCase();
  if (normalized.endsWith('.t.me') || normalized.endsWith('.ton')) {
    return TON_DNS_RE.test(wallet.startsWith('@') ? wallet : normalized);
  }
  return false;
};
const MINIAPP_SESSION_KEY = 'miniapp_session_token';

interface TelegramWidgetUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

function isLikelyTelegramWebApp(): boolean {
  const win = window as any;
  if (win.Telegram?.WebApp?.initData && win.Telegram?.WebApp?.initDataUnsafe?.user) {
    return true;
  }
  if (window.location.hash.includes('tgWebAppData=')) {
    return true;
  }
  const ua = navigator.userAgent;
  return /\bTelegram\b/i.test(ua) || /TelegramDesktop/i.test(ua);
}

function getMiniAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const win = window as any;
  if (win.Telegram?.WebApp?.initData) {
    headers['X-Telegram-Init-Data'] = win.Telegram.WebApp.initData;
  } else {
    const token = localStorage.getItem(MINIAPP_SESSION_KEY);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return headers;
}

async function miniApiFetch(path: string, options: RequestInit = {}): Promise<any> {

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `/api${cleanPath}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getMiniAuthHeaders(),
      ...(options.headers || {}),
    },
  });

  if (res.status === 403) {
    try {
      const data = await res.json();
      if (data.banned) {
        return { _banned: true, reason: data.reason || 'Аккаунт заблокирован' };
      }
    } catch {}
    throw new Error('Access denied');
  }

  if (!res.ok) {
    const text = await res.text();
    let message = text || `Request failed with status ${res.status}`;
    try {
      const data = JSON.parse(text);
      if (data?.error) message = data.error;
    } catch {

    }
    throw new Error(message);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

type ViewState =
  | 'home'
  | 'wizard'
  | 'checkout'
  | 'wait_payment'
  | 'devices'
  | 'instruction_view'
  | 'referral'
  | 'referral_detail'
  | 'promo'
  | 'extend_subscription';

type PlatformId = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'androidtv';

interface Plan {
  id: string;
  duration: string;
  price: number;
  highlight: boolean;
  days: number;
  isTrial?: boolean;
  tariffCategory?: 'regular' | 'family';
  devicesLimit?: number;
}

interface PaymentMethodVariant {
  id: string;
  name: string;
  feePercent: number;
}

interface PaymentMethod {
  id: string;
  name: string;
  icon: string | React.ReactNode;
  feePercent: number;
  variants?: PaymentMethodVariant[];
}

interface Device {
  id: number;
  name: string;
  type: PlatformId | string;
  added: string;
  key_uuid?: string;
  short_uuid?: string;
  key_status?: string;
  days_left?: number;
  hours_left?: number;
  is_expired?: boolean;
  expiry_date?: string;
  is_trial?: boolean;
}

interface ReferralTransaction {
  date: string;
  title: string;
  type: string;
  amount: number;
  income: number;
}

interface ReferralUser {
  id: number;
  name: string;
  date: string;
  spent: number;
  myProfit: number;
  history: ReferralTransaction[];
}

interface InstructionStep {
  title: string;
  desc: string;
  actions?: {
    label: string;
    type?: 'copy_key' | 'trigger_add' | 'nav_android' | 'nav_ios';
    url?: string;
    primary?: boolean;
  }[];
}

interface PlatformData {
  id: PlatformId;
  title: string;
  icon: React.ReactNode;
  steps: InstructionStep[];
}

const OFFER_AGREEMENT_TEXT = `
**Редакция от 01.01.2024 (Версия 2.0)**

Настоящий документ является официальным предложением (публичной офертой) сервиса **1FEDERAL VPN** (далее — «Исполнитель») и содержит все существенные условия предоставления услуг по предоставлению удаленного доступа к сети Интернет.

### 1. ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ
В целях настоящего Документа используются следующие термины:
* **1.1. Сервис (1FEDERAL VPN)** — программно-аппаратный комплекс, предоставляющий функционал перенаправления интернет-трафика через удаленные серверы.
* **1.2. Ключ доступа (Конфигурация)** — уникальный цифровой код/файл, генерируемый Сервисом, являющийся техническим средством аутентификации Пользователя в системе.
* **1.3. Стороннее ПО** — программное обеспечение третьих лиц (в т.ч. приложение «Happ», V2Ray и аналоги), устанавливаемое Пользователем на свое устройство для взаимодействия с Сервисом.
* **1.4. Аномальная активность** — паттерны сетевого поведения, отклоняющиеся от стандартного профиля использования (в т.ч. массовые рассылки, сканирование портов, превышение лимитов сессий).

### 2. ПРЕДМЕТ СОГЛАШЕНИЯ
* **2.1.** Исполнитель предоставляет Пользователю неисключительное право (лицензию) на использование Ключа доступа к инфраструктуре Сервиса, а Пользователь обязуется оплатить данное право.
* **2.2.** Доступ к Сервису предоставляется по принципу **«AS IS» («КАК ЕСТЬ»)**. Исполнитель не гарантирует совместимость Сервиса с любым конкретным программным обеспечением или устройством Пользователя.
* **2.3. Момент оказания услуги.** Услуга считается оказанной в полном объеме и надлежащего качества в момент автоматической отправки Ключа доступа в интерфейсе Telegram-бота. С этого момента обязательства Исполнителя считаются выполненными.

### 3. ТЕХНИЧЕСКИЕ УСЛОВИЯ И ОГРАНИЧЕНИЯ
* **3.1. Локации и Маршруты.** Пользователю предоставляется доступ к динамическому пулу серверов. Исполнитель вправе в одностороннем порядке, без предварительного уведомления, изменять географическое расположение серверов, IP-адреса и маршруты трафика в целях оптимизации нагрузки. Наличие конкретной страны (геолокации) не гарантируется.
* **3.2. Скорость соединения.** Скорость доступа к сети Интернет через Сервис не является фиксированной и зависит от:
    * Нагрузки на общий (shared) канал связи;
    * Удаленности конечного ресурса;
    * Ограничений интернет-провайдера Пользователя (в т.ч. шейпинга UDP/TCP трафика).
* **3.3. Лицензионные ограничения.** Один Ключ доступа предназначен для использования строго на **1 (одном) устройстве**.
    * Система автоматически фиксирует нарушение данного условия.
    * При выявлении одновременных сессий с разных устройств, Ключ блокируется автоматически.
* **3.4. Стороннее ПО.** Исполнитель не является разработчиком клиентских приложений (Happ и др.) и не несет ответственности за их удаление из магазинов приложений (AppStore/Google Play), сбои в их работе или некорректные обновления.

### 4. РЕГЛАМЕНТ ТЕХНИЧЕСКОГО ОБСЛУЖИВАНИЯ (SLA)
* **4.1. Плановые работы.** Исполнитель вправе проводить технические работы с полной остановкой Сервиса на неограниченное время, при условии уведомления Пользователей (в канале или боте) не менее чем за 24 часа.
* **4.2. Аварийные работы.** Допускается перерыв в предоставлении Услуг без предварительного уведомления общей продолжительностью до **100 (ста) часов в календарный месяц**. Данные перерывы не являются основанием для перерасчета стоимости или возврата средств.
* **4.3.** Блокировка доступа к Сервису со стороны государственных регуляторов (РКН) или интернет-провайдеров признается обстоятельством непреодолимой силы (Форс-мажор) и исключает ответственность Исполнителя.

### 5. ПОЛИТИКА ВОЗВРАТА СРЕДСТВ (REFUND POLICY)
* **5.1.** Возврат денежных средств возможен **исключительно** при одновременном соблюдении **ВСЕХ** следующих условий:
    * а) С момента покупки прошло не более 72 часов (3 суток);
    * б) Объем потребленного трафика по Ключу составляет менее **1 (одного) Мегабайта**;
    * в) Пользователь обратился в Техническую поддержку, и специалисты Поддержки не смогли обеспечить подключение на устройстве Пользователя в течение 24 часов с момента обращения.
* **5.2.** Во всех иных случаях, включая (но не ограничиваясь) низкую скорость, высокий пинг, субъективное нежелание использовать Сервис, возврат средств **НЕ ПРОИЗВОДИТСЯ**.

### 6. ОТВЕТСТВЕННОСТЬ И ПРАВИЛА ИСПОЛЬЗОВАНИЯ
* **6.1. Запрещенные действия.** Пользователю категорически запрещено:
    * Использовать торрент-клиенты (P2P протоколы);
    * Осуществлять массовые рассылки (спам);
    * Сканировать порты, IP-адреса, осуществлять DDoS-атаки;
    * Распространять Ключ доступа третьим лицам (перепродажа, «слив» в публичный доступ).
    * Использовать Сервис для противоправных действий согласно УК РФ.
* **6.2. Санкции за нарушения.**
    * При выявлении нарушений (в т.ч. автоматическими алгоритмами анализа трафика) доступ к Услуге **приостанавливается**.
    * Срок действия подписки в период приостановки **не продлевается и не замораживается**.
* **6.3. Порядок обжалования.**
    * Пользователь имеет право подать апелляцию в Техническую поддержку в течение **7 (семи) календарных дней** с момента блокировки.
    * Бремя доказывания отсутствия нарушений лежит на Пользователе.
    * Администрация оставляет за собой право отказать в разблокировке и в предоставлении подробностей о причинах блокировки в целях защиты алгоритмов безопасности Сервиса.

### 7. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ
* **7.1.** Администрация вправе в одностороннем порядке вносить изменения в настоящую Оферту.
* **7.2.** Оплата Услуг означает полное и безоговорочное согласие с условиями настоящей Оферты.
`;

const PRIVACY_POLICY_TEXT = `
### 1. ОБЩИЕ ПОЛОЖЕНИЯ
**1.1.** Настоящая Политика регламентирует порядок сбора, обработки и хранения технических данных пользователей сервиса 1FEDERAL VPN.
**1.2.** Основным приоритетом Сервиса является минимизация хранимых персональных данных при обеспечении технической стабильности и безопасности сети.

### 2. СОСТАВ СОБИРАЕМЫХ ДАННЫХ
Сервис не осуществляет сбор, хранение или анализ содержимого интернет-трафика Пользователя (Deep Packet Inspection), истории посещенных веб-ресурсов или переписки.
В целях технического обеспечения Услуг собираются следующие метаданные:

**2.1. Идентификационные данные платформы:**
* Уникальный идентификатор пользователя Telegram (Telegram ID);
* Имя пользователя (Username);
* История обращений в службу поддержки (включая переданные скриншоты и логи ошибок).

**2.2. Технические данные сессий:**
* **Объем трафика:** Учет входящих и исходящих пакетов данных (в байтах) для контроля лимитов и выявления аномальной нагрузки.
* **Аппаратные идентификаторы:** Хешированные данные об устройстве (HWID) или уникальные «отпечатки» клиента (Fingerprint). Сбор данных осуществляется исключительно с целью предотвращения мультиаккаунтинга (нарушение правила «1 ключ = 1 устройство») и борьбы с перепродажей Ключей.

**2.3. Платежные данные:**
* ID транзакции, сумма, метод оплаты. Полные данные банковских карт не обрабатываются и не хранятся Сервисом (обработка производится на стороне платежных шлюзов).

### 3. ЦЕЛИ ОБРАБОТКИ И ХРАНЕНИЯ
**3.1.** Обеспечение автоматической выдачи и ротации цифровых ключей.
**3.2.** Автоматический мониторинг нагрузки на сеть и предотвращение перегрузок (DDoS).
**3.3.** Выявление нарушений Условий использования (сканирование портов, спам-активность) на основе анализа метаданных трафика.

### 4. ПЕРЕДАЧА ДАННЫХ И ВЗАИМОДЕЙСТВИЕ С ТРЕТЬИМИ ЛИЦАМИ
**4.1.** Сервис не передает данные третьим лицам в коммерческих или маркетинговых целях.
**4.2.** Раскрытие накопленных метаданных государственным органам возможно исключительно при наличии вступившего в законную силу судебного акта, оформленного в соответствии с процессуальным законодательством РФ, и врученного Администрации Сервиса надлежащим образом.

### 5. ОТКАЗ ОТ ОТВЕТСТВЕННОСТИ
**5.1.** Пользователь осознает, что использование сети Интернет связано с рисками. Сервис не несет ответственности за перехват данных, произошедший на устройстве Пользователя или на узлах сети, не контролируемых Сервисом.
`;

const VPN_PLANS_DEFAULT: Plan[] = [
  { id: 'trial_7d', duration: 'Пробная подписка', price: 1, highlight: false, days: 7, isTrial: true, tariffCategory: 'regular', devicesLimit: 2 },
  { id: 'reg_m1', duration: '1 месяц', price: 499, highlight: false, days: 30, tariffCategory: 'regular', devicesLimit: 2 },
  { id: 'reg_m3', duration: '3 месяца', price: 1399, highlight: false, days: 90, tariffCategory: 'regular', devicesLimit: 2 },
  { id: 'reg_m6', duration: '6 месяцев', price: 2699, highlight: false, days: 180, tariffCategory: 'regular', devicesLimit: 2 },
  { id: 'reg_y1', duration: '12 месяцев', price: 4999, highlight: false, days: 365, tariffCategory: 'regular', devicesLimit: 2 },
  { id: 'fam_m1', duration: '1 месяц', price: 899, highlight: false, days: 30, tariffCategory: 'family', devicesLimit: 5 },
  { id: 'fam_m3', duration: '3 месяца', price: 2499, highlight: false, days: 90, tariffCategory: 'family', devicesLimit: 5 },
  { id: 'fam_m6', duration: '6 месяцев', price: 4899, highlight: false, days: 180, tariffCategory: 'family', devicesLimit: 5 },
  { id: 'fam_y1', duration: '12 месяцев', price: 8999, highlight: false, days: 365, tariffCategory: 'family', devicesLimit: 5 },
];

const mapApiTariffCategory = (planType: string): 'regular' | 'family' => {
  if (planType === 'vpn_family') return 'family';
  return 'regular';
};

const PAYMENT_METHODS_DEFAULT: PaymentMethod[] = [
  { id: 'lava_sbp', name: 'СБП', icon: '⚡', feePercent: 0 },
  { id: 'lava_card', name: 'Банковская карта', icon: '💳', feePercent: 0 },
];

const PLATFORMS: { id: PlatformId; name: string; icon: React.ReactNode }[] = [
  { id: 'android', name: 'Android', icon: <Smartphone size={32} /> },
  { id: 'ios', name: 'iOS (iPhone)', icon: <Apple size={32} /> },
  { id: 'windows', name: 'Windows PC', icon: <Monitor size={32} /> },
  { id: 'macos', name: 'MacOS', icon: <Command size={32} /> },
  { id: 'linux', name: 'Linux', icon: <Monitor size={32} /> },
  { id: 'androidtv', name: 'Android TV', icon: <Tv size={32} /> },
];

const INSTRUCTIONS: Record<string, PlatformData> = {
  android: {
    id: 'android',
    title: 'Android',
    icon: <Smartphone size={20} />,
    steps: [
      {
        title: '1. Установка приложения',
        desc: 'Установите приложение из Google Play или скачайте APK.',
        actions: [
          { label: 'Google Play', url: 'https://play.google.com/store/apps/details?id=com.happproxy', primary: true },
          { label: 'Скачать .APK', url: 'https://github.com/Happ-proxy/happ-android/releases/latest/download/Happ.apk', primary: false }
        ]
      },
      {
        title: '2. Добавляем подписку',
        desc: 'Нажмите кнопку ниже, чтобы добавить подписку в приложение.',
        actions: [
          { label: 'Добавить подписку', type: 'trigger_add', primary: true }
        ]
      },
      {
        title: '3. Обновляем и подключаемся',
        desc: 'В приложении нажмите кнопку обновления (🔄) и выберите локацию.'
      }
    ]
  },
  ios: {
    id: 'ios',
    title: 'iOS (iPhone/iPad)',
    icon: <Apple size={20} />,
    steps: [
      {
        title: '1. Установка приложения',
        desc: 'Установите приложение из App Store.',
        actions: [
          { label: 'App Store', url: 'https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973', primary: true }
        ]
      },
      {
        title: '2. Добавляем подписку',
        desc: 'Нажмите кнопку ниже для автоматического добавления.',
        actions: [
          { label: 'Добавить подписку', type: 'trigger_add', primary: true }
        ]
      },
      {
        title: '3. Подключение',
        desc: 'Нажмите (🔄) в приложении, выберите сервер и подключитесь.',
        actions: [
          { label: 'Подключиться!', url: 'happ://connect', primary: true }
        ]
      }
    ]
  },
  windows: {
    id: 'windows',
    title: 'Windows',
    icon: <Monitor size={20} />,
    steps: [
      {
        title: '1. Установка',
        desc: 'Скачайте и установите .EXE файл.',
        actions: [
          { label: 'Скачать .EXE', url: 'https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe', primary: true }
        ]
      },
      {
        title: '2. Копирование ключа',
        desc: 'Скопируйте ваш персональный ключ доступа.',
        actions: [
          { label: 'Скопировать ключ', type: 'copy_key', primary: true }
        ]
      },
      {
        title: '3. Настройка',
        desc: 'Вставьте скопированный ключ в приложение и подключитесь.'
      }
    ]
  },
  macos: {
    id: 'macos',
    title: 'MacOS',
    icon: <Command size={20} />,
    steps: [
      {
        title: '1. Установка',
        desc: 'Установите через AppStore.',
        actions: [
          { label: 'App Store', url: 'https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973', primary: true }
        ]
      },
      {
        title: '2. Ключ доступа',
        desc: 'Скопируйте ключ и вставьте его в приложении.',
        actions: [
          { label: 'Скопировать ключ', type: 'copy_key', primary: true }
        ]
      }
    ]
  },
  linux: {
    id: 'linux',
    title: 'Linux',
    icon: <Monitor size={20} />,
    steps: [
      {
        title: '1. Установка',
        desc: 'Скачайте релиз с GitHub.',
        actions: [
          { label: 'GitHub Releases', url: 'https://github.com/Happ-proxy/happ-desktop/releases/', primary: true }
        ]
      },
      {
        title: '2. Ключ доступа',
        desc: 'Скопируйте ключ и вставьте его в приложении.',
        actions: [
          { label: 'Скопировать ключ', type: 'copy_key', primary: true }
        ]
      }
    ]
  },
  androidtv: {
    id: 'androidtv',
    title: 'Android TV',
    icon: <Tv size={20} />,
    steps: [
      {
        title: '1. Подготовка',
        desc: 'Сначала добавьте ключ на свой смартфон.',
        actions: [
          { label: 'Инструкция Android', type: 'nav_android', primary: false },
          { label: 'Инструкция iOS', type: 'nav_ios', primary: false }
        ]
      },
      {
        title: '2. Установка на TV',
        desc: 'Найдите "Happ" в Google Play на телевизоре и установите.'
      },
      {
        title: '3. Синхронизация',
        desc: 'На TV: нажмите "+" -> "Добавить подписку". На телефоне: "+" -> "QR-код". Отсканируйте код.'
      }
    ]
  }
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'trial' | 'gold';
}

const Button: React.FC<ButtonProps> = ({ children, onClick, variant = 'primary', className = '', disabled = false }) => {
  const baseStyle = "w-full py-3.5 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed ripple";
  const variants = {
    primary: "bg-blue-500 hover:bg-blue-600 text-white",
    secondary: "bg-white/5 hover:bg-white/10 text-white border border-white/10",
    outline: "border border-blue-500/50 text-blue-400 hover:bg-blue-500/10",
    danger: "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/40",
    ghost: "text-gray-400 hover:text-white hover:bg-white/5",
    trial: "bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:brightness-110",
    gold: "bg-gradient-to-r from-amber-500 to-yellow-500 text-white"
  };

  return (
    <button onClick={onClick} className={`${baseStyle} ${variants[variant]} ripple ${className}`} disabled={disabled}>
      {children}
    </button>
  );
};

const Card: React.FC<{ children: React.ReactNode, className?: string, onClick?: () => void }> = ({ children, className = '', onClick }) => (
  <div onClick={onClick} className={`bg-white/5 border border-white/10 rounded-2xl p-5 ${className}`}>
    {children}
  </div>
);

const Header: React.FC<{ title: string, onBack?: () => void }> = ({ title, onBack }) => (
  <div className="flex items-center gap-4 py-6 px-4">
    {onBack && (
      <button onClick={onBack} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white hover:bg-white/10 transition-colors shrink-0">
        <ChevronLeft size={22} />
      </button>
    )}
    <h1 className="text-2xl font-bold text-white">{title}</h1>
  </div>
);

const Modal: React.FC<{ title: string, isOpen: boolean, onClose: () => void, children: React.ReactNode, fullHeight?: boolean }> = ({ title, isOpen, onClose, children, fullHeight = false }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
      <div className={`relative bg-black border border-white/10 w-full max-w-sm rounded-3xl p-6 shadow-2xl transform transition-all scale-100 flex flex-col ${fullHeight ? 'h-[85vh]' : 'max-h-[90vh]'}`}>
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h3 className="text-xl font-bold text-white">{title}</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto custom-scrollbar flex-1 pr-1">
            {children}
        </div>
      </div>
    </div>
  );
};

const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');
  return (
    <div className="space-y-3 text-slate-300 text-sm leading-relaxed">
      {lines.map((line, idx) => {
        if (line.startsWith('### ')) {
          return <h3 key={idx} className="text-lg font-bold text-white mt-4 mb-2">{line.replace('### ', '')}</h3>;
        }
        if (line.startsWith('**') && !line.includes('**', 2)) {

          return <p key={idx} className="font-bold text-white">{line.replace(/\*\*/g, '')}</p>;
        }
        if (line.startsWith('* ')) {

           const cleanLine = line.replace('* ', '');

           const parts = cleanLine.split('**');
           return (
             <div key={idx} className="flex gap-2 pl-2">
                <span className="text-blue-500 mt-1.5">•</span>
                <span>
                    {parts.map((part, pIdx) => (pIdx % 2 === 1 ? <strong key={pIdx} className="text-slate-200">{part}</strong> : part))}
                </span>
             </div>
           );
        }

        const parts = line.split('**');
        return (
            <p key={idx} className={line.trim() === '' ? 'h-2' : ''}>
                {parts.map((part, pIdx) => (pIdx % 2 === 1 ? <strong key={pIdx} className="text-slate-200">{part}</strong> : part))}
            </p>
        );
      })}
    </div>
  );
};

export default function App() {

  const [view, setView] = useState<ViewState>('home');
  const [balance, setBalance] = useState<number>(0);
  const [isTrialUsed, setIsTrialUsed] = useState<boolean>(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [username, setUsername] = useState<string>('User');
  const [displayName, setDisplayName] = useState<string>('User');
  const [userPhotoUrl, setUserPhotoUrl] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [fromTelegram, setFromTelegram] = useState(() => isLikelyTelegramWebApp());
  const [fromTelegram, setFromTelegram] = useState(() => isLikelyTelegramWebApp());
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const telegramWidgetRef = useRef<HTMLDivElement>(null);

  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceKeys, setDeviceKeys] = useState<Map<number, string>>(new Map());

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docContent, setDocContent] = useState<{ title: string, text: string } | null>(null);
  const [publicPages, setPublicPages] = useState<{ offer: string, privacy: string }>({
    offer: OFFER_AGREEMENT_TEXT,
    privacy: PRIVACY_POLICY_TEXT
  });

  const [currentDevice, setCurrentDevice] = useState<Device | null>(null);
  const [instructionDeviceId, setInstructionDeviceId] = useState<number | null>(null);

  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState<string>('');

  const [referrals, setReferrals] = useState({ count: 0, balance: 0 });
  const [referralList, setReferralList] = useState<ReferralUser[]>([]);
  const [selectedReferral, setSelectedReferral] = useState<ReferralUser | null>(null);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawWallet, setWithdrawWallet] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  const [checkoutAmount, setCheckoutAmount] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(PAYMENT_METHODS_DEFAULT);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<{ type: string, payload: any } | null>(null);

  const [vpnPlans, setVpnPlans] = useState<Plan[]>(VPN_PLANS_DEFAULT);

  const [wizardStep, setWizardStep] = useState(1);
  const [wizardPlatform, setWizardPlatform] = useState<PlatformId>('android');
  const [promoSubscriptionDays, setPromoSubscriptionDays] = useState<number | null>(null);
  const [promoDiscountPercent, setPromoDiscountPercent] = useState<number>(0);
  const [wizardPlan, setWizardPlan] = useState<Plan | null>(null);
  const [wizardTariffTab, setWizardTariffTab] = useState<'regular' | 'family'>('regular');
  const [wizardType] = useState<'vpn'>('vpn');
  const [useAutoPay, setUseAutoPay] = useState(false);
  const [savedPaymentMethods, setSavedPaymentMethods] = useState<any[]>([]);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | null>(null);

  const [extendingDevice, setExtendingDevice] = useState<Device | null>(null);
  const [extendPlan, setExtendPlan] = useState<Plan | null>(null);

  const [activePlatform, setActivePlatform] = useState<string>('android');

  const deviceNeedsRenew = (device: Device) => {
    if (device.is_expired) return true;
    if (device.days_left != null && device.days_left < 3) return true;
    return false;
  };

  const primarySubscription = devices.find(d => !d.is_expired) ?? devices[0] ?? null;
  const hasActiveSubscription = devices.some(d => !d.is_expired);

  const openDeviceSetup = (device: Device) => {
    setInstructionDeviceId(device.id);
    setActivePlatform((device.type as PlatformId) || 'android');
    setView('instruction_view');
  };

  const openDeviceRenew = (device: Device) => {
    setExtendingDevice(device);
    setExtendPlan(null);
    setView('extend_subscription');
  };

  const openPurchaseWizard = (promoDaysOverride?: number | null) => {
    const pd = promoDaysOverride ?? promoSubscriptionDays;
    if (pd == null && hasActiveSubscription && primarySubscription) {
      if (window.confirm('У вас уже есть активная подписка. Перейти к продлению?')) {
        openDeviceRenew(primarySubscription);
      }
      return;
    }
    if (pd != null && pd > 0) {
      setWizardPlan({
        id: 'promo_sub',
        duration: `Промокод (${pd} дн.)`,
        price: 0,
        days: pd,
        highlight: true,
        isTrial: false,
      });
      setWizardStep(2);
    } else {
      setWizardPlan(null);
      setWizardStep(1);
      setWizardTariffTab('regular');
    }
    setView('wizard');
  };

  const bootstrapUserData = useCallback(async (
    tgId: number,
    tgUsername: string,
    tgFirstName: string,
    referralId: number | null,
    photoUrl?: string | null,
  ) => {
    if (photoUrl) {
      setUserPhotoUrl(photoUrl);
    }

    setTelegramId(tgId);
    if (tgUsername) setUsername(tgUsername);
    setDisplayName(tgFirstName || tgUsername || 'User');

    let userUrl = `/user/info?telegram_id=${tgId}&username=${encodeURIComponent(tgUsername)}`;
    if (tgFirstName) {
      userUrl += `&first_name=${encodeURIComponent(tgFirstName)}`;
    }
    if (referralId) {
      userUrl += `&ref=${referralId}`;
    }
    const userData = await miniApiFetch(userUrl);

    if (userData && userData._banned) {
      setIsBanned(true);
      setBanReason(userData.reason || 'Аккаунт заблокирован');
      return;
    }

    if (userData) {
      setUserId(userData.id);
      setBalance(userData.balance || 0);
      setUsername(userData.username || `User_${tgId}`);
      setDisplayName(userData.full_name || tgFirstName || userData.username || `User_${tgId}`);
      setIsTrialUsed(userData.trial_used === 1 || userData.trial_used === true);
      setReferrals({
        count: userData.referrals_count || 0,
        balance: userData.referral_balance ?? userData.partner_balance ?? 0,
      });
      const disc0 = Number(userData.promo_discount_percent);
      setPromoDiscountPercent(Number.isFinite(disc0) && disc0 > 0 ? disc0 : 0);
      const pend0 = userData.pending_promo_days;
      if (pend0 != null && Number(pend0) > 0) {
        setPromoSubscriptionDays(Number(pend0));
      } else {
        setPromoSubscriptionDays(null);
      }
    }

    const devicesData = await miniApiFetch(`/user/devices?telegram_id=${tgId}`);
    if (Array.isArray(devicesData)) {
      const devicesList: Device[] = devicesData.map((d: any) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        added: d.added,
        key_uuid: d.key_uuid,
        short_uuid: d.short_uuid,
        key_status: d.key_status,
        days_left: d.days_left,
        hours_left: d.hours_left,
        is_expired: d.is_expired,
        expiry_date: d.expiry_date
      }));
      setDevices(devicesList);

      const keysMap = new Map<number, string>();
      devicesData.forEach((d: any) => {
        if (d.key_config) {
          keysMap.set(d.id, d.key_config);
        }
      });
      setDeviceKeys(keysMap);
    }

    try {
      const publicPagesData = await miniApiFetch('/public-pages');
      if (publicPagesData) {
        setPublicPages({
          offer: publicPagesData.offer?.content || OFFER_AGREEMENT_TEXT,
          privacy: publicPagesData.privacy?.content || PRIVACY_POLICY_TEXT
        });
      }
    } catch (e) {
      console.error('Failed to load public pages, using defaults', e);
    }

    try {
      const tariffsData = await miniApiFetch('/tariffs');
      if (Array.isArray(tariffsData) && tariffsData.length) {
        const paidPlans: Plan[] = tariffsData
          .filter((p: any) => p && p.is_active && (p.plan_type === 'vpn_regular' || p.plan_type === 'vpn_family' || p.plan_type === 'vpn'))
          .map((p: any) => {
            const category = mapApiTariffCategory(String(p.plan_type || 'vpn_regular'));
            return {
              id: `tariff_${p.id}`,
              duration: String(p.name || `${p.duration_days} дней`),
              price: Number(p.price) || 0,
              highlight: false,
              days: Number(p.duration_days) || 1,
              isTrial: false,
              tariffCategory: category,
              devicesLimit: category === 'family' ? 5 : 2,
            };
          })
          .filter(p => Number.isFinite(p.price) && p.price >= 0 && Number.isFinite(p.days) && p.days > 0);

        const trial = VPN_PLANS_DEFAULT.find(p => p.isTrial);
        const combined = trial ? [trial, ...paidPlans] : paidPlans;
        setVpnPlans(combined.length ? combined : VPN_PLANS_DEFAULT);
      } else {
        setVpnPlans(VPN_PLANS_DEFAULT);
      }
    } catch (e) {
      console.error('Failed to load tariffs, using defaults', e);
      setVpnPlans(VPN_PLANS_DEFAULT);
    }
  }, []);

  const handleTelegramWidgetAuth = useCallback(async (user: TelegramWidgetUser) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const refParam = params.get('ref');
      let referralId: number | null = null;
      if (refParam) {
        referralId = parseInt(refParam, 10);
        if (isNaN(referralId) || referralId === user.id) referralId = null;
      }

      const res = await fetch('/api/auth/telegram-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Не удалось войти через Telegram');
      }

      localStorage.setItem(MINIAPP_SESSION_KEY, data.session_token);
      setNeedsLogin(false);
      await bootstrapUserData(
        data.telegram_id,
        data.username || user.username || '',
        data.first_name || user.first_name || '',
        referralId,
        data.photo_url || user.photo_url || null,
      );
    } catch (e: any) {
      console.error('Telegram widget auth failed:', e);
      setAuthError(e?.message || 'Ошибка авторизации');
    } finally {
      setAuthLoading(false);
    }
  }, [bootstrapUserData]);

  useEffect(() => {
    const win: any = window as any;

    const waitForTelegramUser = async (maxMs = 5000): Promise<any | null> => {
      const step = 50;
      for (let t = 0; t < maxMs; t += step) {
        const webApp = win.Telegram?.WebApp;
        const user = webApp?.initDataUnsafe?.user;
        const initData = webApp?.initData;
        if (user && initData) return user;
        await new Promise((r) => setTimeout(r, step));
      }
      const webApp = win.Telegram?.WebApp;
      if (webApp?.initDataUnsafe?.user && webApp?.initData) {
        return webApp.initDataUnsafe.user;
      }
      return null;
    };

    const hideBootLoader = () => {
      const bootLoader = document.getElementById('boot-loader');
      if (bootLoader) bootLoader.classList.add('hidden');
    };

    const ua = navigator.userAgent.toLowerCase();
    let detected: PlatformId = 'android';
    if (ua.includes('iphone') || ua.includes('ipad')) detected = 'ios';
    else if (ua.includes('android')) detected = 'android';
    else if (ua.includes('win')) detected = 'windows';
    else if (ua.includes('mac')) detected = 'macos';
    else if (ua.includes('linux')) detected = 'linux';

    setActivePlatform(detected);
    setWizardPlatform(detected);

    (async () => {
      let tgId: number | null = null;
      let tgUsername: string = '';
      let tgFirstName: string = '';
      let referralId: number | null = null;

      const inTelegram = isLikelyTelegramWebApp();
      setFromTelegram(inTelegram);

      if (inTelegram) {
        const tgUser = await waitForTelegramUser();
        if (tgUser) {
          tgId = Number(tgUser.id);
          tgUsername = tgUser.username || '';
          tgFirstName = tgUser.first_name || '';

          if (tgUser.photo_url) {
            setUserPhotoUrl(tgUser.photo_url);
          }

          const startParam = win.Telegram.WebApp.initDataUnsafe?.start_param;
          if (startParam && typeof startParam === 'string') {
            const refMatch = startParam.match(/ref(\d+)/);
            if (refMatch) {
              referralId = parseInt(refMatch[1], 10);
              if (referralId === tgId) referralId = null;
            }
          }

          win.Telegram.WebApp.ready();
          try { win.Telegram.WebApp.expand(); } catch {}
          try {
            if (typeof win.Telegram.WebApp.disableVerticalSwipes === 'function') {
              win.Telegram.WebApp.disableVerticalSwipes();
            }
          } catch {}
        }
      } else {
        hideBootLoader();

        const params = new URLSearchParams(window.location.search);
        const refParam = params.get('ref');
        if (refParam) {
          referralId = parseInt(refParam, 10);
          if (isNaN(referralId)) referralId = null;
        }

        const savedToken = localStorage.getItem(MINIAPP_SESSION_KEY);
        if (savedToken) {
          try {
            const me = await miniApiFetch('/auth/me');
            if (me?.telegram_id) {
              tgId = Number(me.telegram_id);
              tgUsername = me.username || '';
              tgFirstName = me.first_name || '';
              if (me.photo_url) setUserPhotoUrl(me.photo_url);
              if (referralId === tgId) referralId = null;
            }
          } catch {
            localStorage.removeItem(MINIAPP_SESSION_KEY);
          }
        }

        if (!tgId) {
          setNeedsLogin(true);
          return;
        }
      }

      hideBootLoader();

      if (!tgId) {
        setNeedsLogin(true);
        return;
      }

      try {
        await bootstrapUserData(tgId, tgUsername, tgFirstName, referralId);
      } catch (err) {
        console.error('Ошибка загрузки данных:', err);
        if (localStorage.getItem(MINIAPP_SESSION_KEY)) {
          localStorage.removeItem(MINIAPP_SESSION_KEY);
          setNeedsLogin(true);
          setTelegramId(null);
        }
      }
    })();
  }, [bootstrapUserData]);

  useEffect(() => {
    if (!needsLogin) return;

    const win = window as any;
    win.onTelegramAuth = (user: TelegramWidgetUser) => {
      handleTelegramWidgetAuth(user);
    };

    const container = telegramWidgetRef.current;
    if (!container) return;

    container.innerHTML = '';
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', BOT_USERNAME_MINI);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    container.appendChild(script);

    return () => {
      delete win.onTelegramAuth;
      container.innerHTML = '';
    };
  }, [needsLogin, handleTelegramWidgetAuth]);

  useEffect(() => {
    if (!telegramId) return;
    (async () => {
      try {
        const data = await miniApiFetch(`/user/referrals?telegram_id=${telegramId}`);
        if (Array.isArray(data)) {
          setReferralList(data);
        }
      } catch (e) {
        console.error('Failed to load referrals list', e);
      }
    })();
  }, [telegramId]);

  const activeNavIndex = useMemo(() => {
    if (view === 'home') return 0;
    if (view === 'referral' || view === 'referral_detail') return 1;
    if (view === 'devices' || view === 'wizard' || view === 'extend_subscription' || view === 'instruction_view') return 2;
    if (view === 'promo') return 3;
    return -1;
  }, [view]);

  const navGridRef = useRef<HTMLDivElement>(null);
  const [navIndicator, setNavIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const updateNavIndicator = () => {
      const grid = navGridRef.current;
      if (!grid || activeNavIndex < 0) {
        setNavIndicator(null);
        return;
      }
      const buttons = grid.querySelectorAll<HTMLElement>('[data-nav-item]');
      const btn = buttons[activeNavIndex];
      if (!btn) return;
      setNavIndicator({ left: btn.offsetLeft, width: btn.offsetWidth });
    };

    const frame = requestAnimationFrame(updateNavIndicator);
    const grid = navGridRef.current;
    const ro = grid ? new ResizeObserver(updateNavIndicator) : null;
    if (grid && ro) ro.observe(grid);
    window.addEventListener('resize', updateNavIndicator);

    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener('resize', updateNavIndicator);
    };
  }, [activeNavIndex, view]);

  const formatMoney = (val: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(val);
  const rubToUsdt = (rub: number) => {
    if (!rub || rub <= 0) return 0;
    return Math.round((rub / REFERRAL_RUB_PER_USD) * 100) / 100;
  };

  const buildPlanPayload = (plan: Plan, price: number) => ({
    days: plan.days,
    type: plan.tariffCategory === 'family' ? 'vpn_family' : 'vpn_regular',
    price,
    devices_limit: plan.devicesLimit ?? (plan.tariffCategory === 'family' ? 5 : 2),
    tariff_category: plan.tariffCategory ?? 'regular',
  });

  const trialPlan = (vpnPlans || VPN_PLANS_DEFAULT).find(p => p.isTrial);
  const paidPlansByCategory = (category: 'regular' | 'family') =>
    (vpnPlans || VPN_PLANS_DEFAULT).filter(p => !p.isTrial && p.tariffCategory === category);

  const showTrialPromo = !isTrialUsed && !!trialPlan && !hasActiveSubscription;

  const activateTrial = () => {
    if (!trialPlan) return;
    setWizardPlan(trialPlan);
    setWizardStep(2);
    setWizardTariffTab('regular');
    setView('wizard');
  };

  const startCheckout = (amount: number, action: { type: string; payload: any }) => {
    if (amount <= 0) return;
    setCheckoutAmount(amount);
    setPendingAction(action);
    setSelectedMethod(null);
    setSelectedVariant(null);
    setView('checkout');
  };

  const TrialPromoBanner = () => {
    const days = trialPlan?.days ?? 7;
    const devicesLimit = trialPlan?.devicesLimit ?? 2;
    return (
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black p-6 text-center">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.35) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="relative">
          <h3 className="text-base font-bold text-white uppercase tracking-wide mb-2">
            Бесплатный пробный период
          </h3>
          <p className="text-sm text-gray-400 mb-6">
            Попробуйте наш VPN бесплатно — без обязательств
          </p>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div>
              <div className="text-3xl font-bold text-white leading-none">{days}</div>
              <div className="text-xs text-gray-500 mt-1">дней</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-white leading-none">10</div>
              <div className="text-xs text-gray-500 mt-1">ГБ</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-white leading-none">{devicesLimit}</div>
              <div className="text-xs text-gray-500 mt-1">устройств</div>
            </div>
          </div>
          <button
            onClick={activateTrial}
            className="w-full py-3.5 rounded-full bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm transition-colors shadow-[0_4px_24px_rgba(59,130,246,0.35)]"
          >
            Активировать бесплатно
          </button>
        </div>
      </div>
    );
  };

  const refreshDevices = async () => {
    if (!telegramId) return;
    try {
      const devicesData = await miniApiFetch(`/user/devices?telegram_id=${telegramId}`);
      if (Array.isArray(devicesData)) {
        const devicesList: Device[] = devicesData.map((d: any) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          added: d.added,
          key_uuid: d.key_uuid,
          short_uuid: d.short_uuid,
          key_status: d.key_status,
          days_left: d.days_left,
          hours_left: d.hours_left,
          is_expired: d.is_expired,
          expiry_date: d.expiry_date
        }));
        setDevices(devicesList);

        const keysMap = new Map<number, string>();
        devicesData.forEach((d: any) => {
          if (d.key_config) {
            keysMap.set(d.id, d.key_config);
          }
        });
        setDeviceKeys(keysMap);
      }
    } catch (e) {
      console.error('Failed to refresh devices', e);
    }
  };

  const priceAfterPromoDiscount = (planPrice: number) => {
    const p = promoDiscountPercent || 0;
    if (p <= 0 || planPrice <= 0) return planPrice;
    return Math.round(planPrice * (1 - Math.min(p, 100) / 100) * 100) / 100;
  };

  const refreshUserData = async (): Promise<{ balance: number } | null> => {
    if (!telegramId) return null;
    try {
      const userData = await miniApiFetch(`/user/info?telegram_id=${telegramId}`);
      if (userData) {
        const newBalance = userData.balance || 0;
        setBalance(newBalance);
        setUserId(userData.id);
        setUsername(userData.username || `User_${telegramId}`);
        setIsTrialUsed(userData.trial_used === 1 || userData.trial_used === true);
        const disc = Number(userData.promo_discount_percent);
        setPromoDiscountPercent(Number.isFinite(disc) && disc > 0 ? disc : 0);
        const pend = userData.pending_promo_days;
        if (pend != null && Number(pend) > 0) {
          setPromoSubscriptionDays(Number(pend));
        } else {
          setPromoSubscriptionDays(null);
        }
        setReferrals({
          count: userData.referrals_count || 0,
          balance: userData.referral_balance ?? userData.partner_balance ?? userData.referral_earned ?? 0,
        });
        return { balance: newBalance };
      }
      return null;
    } catch (e) {
      console.error('Failed to refresh user data', e);
      return null;
    }
  };

  const refreshAll = async () => {
    await Promise.all([
      refreshUserData(),
      refreshDevices(),
    ]);
  };

  const ensureUserId = async (): Promise<number | null> => {
    if (userId) return userId;
    if (!telegramId) return null;

    try {
      const userData = await miniApiFetch(`/user/info?telegram_id=${telegramId}`);
      if (userData && userData.id) {
        setUserId(userData.id);
        setBalance(userData.balance || 0);
        setIsTrialUsed(userData.trial_used === 1 || userData.trial_used === true);
        return userData.id;
      }
    } catch (e) {
      console.error('Failed to ensure userId', e);
    }
    return null;
  };

  const getHappEncryptedLink = async (subscriptionUrl: string): Promise<string | null> => {
    try {
      const response = await fetch('/api/encrypt-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: subscriptionUrl })
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.encrypted_link) {
          console.log('Got encrypted link:', data.encrypted_link);
          return data.encrypted_link;
        }
      }
      const errorText = await response.text();
      console.error('Encryption API failed:', response.status, errorText);
      return null;
    } catch (e) {
      console.error('Encryption API error:', e);
      return null;
    }
  };

  const openHappWithSubscription = async (deviceId?: number) => {
    console.log('openHappWithSubscription called, deviceId:', deviceId);
    console.log('Available devices:', devices);
    console.log('Device keys:', Array.from(deviceKeys.entries()));

    let subscriptionUrl: string | null = null;

    if (deviceId && deviceKeys.has(deviceId)) {
      subscriptionUrl = deviceKeys.get(deviceId) || null;
    } else {

      const activeDevice = devices.find(d => deviceKeys.has(d.id));
      if (activeDevice) {
        subscriptionUrl = deviceKeys.get(activeDevice.id) || null;
        console.log('Found active device:', activeDevice.id, 'with URL:', subscriptionUrl);
      }
    }

    if (!subscriptionUrl) {
      console.log('No subscription URL found');
      alert('У вас нет активной подписки. Сначала оформите подписку.');
      return;
    }

    console.log('Encrypting URL:', subscriptionUrl);
    const encryptedLink = await getHappEncryptedLink(subscriptionUrl);
    console.log('Encrypted link:', encryptedLink);

    if (!encryptedLink) {
      alert('Не удалось зашифровать ссылку. Попробуйте позже.');
      return;
    }

    const redirectUrl = `${window.location.origin}/api/redirect?url=${encodeURIComponent(encryptedLink)}`;
    console.log('Opening redirect URL:', redirectUrl);

    const win = window as any;
    if (win.Telegram?.WebApp?.openLink) {

      win.Telegram.WebApp.openLink(redirectUrl);
    } else {

      window.open(redirectUrl, '_blank');
    }
  };

  const handleCopy = (text: string, deviceId?: number) => {
    try {

      let keyToCopy = text;
      if (deviceId && deviceKeys.has(deviceId)) {
        keyToCopy = deviceKeys.get(deviceId)!;
      }

      const el = document.createElement('textarea');
      el.value = keyToCopy;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      alert('Скопировано в буфер!');
    } catch (e) {
      console.error(e);
      alert('Ошибка копирования. Пожалуйста, выделите и скопируйте текст вручную.');
    }
  };

  const openDoc = (title: string, text: string) => {
      setDocContent({ title, text });
      setDocModalOpen(true);
  };

  const openDeleteModal = (device: Device) => {
    setCurrentDevice(device);
    setDeleteModalOpen(true);
  };

  const confirmDeleteDevice = async () => {
    if (!currentDevice || !telegramId) return;

    try {

      const result = await miniApiFetch(`/user/devices/${currentDevice.id}?telegram_id=${telegramId}`, {
        method: 'DELETE'
      });

      if (result && result.success) {

        setDevices(prev => prev.filter(d => d.id !== currentDevice.id));
        setDeviceKeys(prev => {
          const newMap = new Map(prev);
          newMap.delete(currentDevice.id);
          return newMap;
        });
      } else {
        alert(result?.error || 'Не удалось удалить подписку');

        refreshDevices();
      }
    } catch (e) {
      console.error('Failed to delete device', e);
      alert('Ошибка при удалении подписки');

      refreshDevices();
    }

    setDeleteModalOpen(false);
    setCurrentDevice(null);
  };

  const extendSubscription = async (device: Device, plan: Plan) => {
    const price = priceAfterPromoDiscount(plan.price);
    startCheckout(price, {
      type: 'extend',
      payload: { device, plan, price, name: `Продление VPN (${plan.duration})` },
    });
  };

  const wizardActivate = async () => {
    const currentUserId = await ensureUserId();
    if (!currentUserId) {
      alert('Не удалось загрузить данные пользователя. Попробуйте перезагрузить приложение.');
      return;
    }

    if (wizardType !== 'vpn' || !wizardPlan) return;

    if (wizardPlan.id === 'promo_sub') {
      try {
        const res = await miniApiFetch('/subscription/create', {
          method: 'POST',
          body: JSON.stringify({
            user_id: currentUserId,
            days: wizardPlan.days,
            type: 'vpn',
            price: 0,
            from_pending_promo: true,
          }),
        });
        if (res && res.success) {
          setPromoSubscriptionDays(null);
          await refreshAll();
          setWizardStep(3);
        } else {
          alert(res?.error || 'Не удалось активировать промокод');
        }
      } catch (e) {
        console.error(e);
        alert('Ошибка при активации промокода');
      }
      return;
    }

    const price = wizardPlan.isTrial
      ? (wizardPlan.price || 0)
      : priceAfterPromoDiscount(wizardPlan.price);
    const tariffLabel = wizardPlan.tariffCategory === 'family' ? 'Семейный' : 'Обычный';
    const name = wizardPlan.isTrial
      ? 'Пробная подписка'
      : `${tariffLabel} (${wizardPlan.duration})`;

    if (price > 0) {
      startCheckout(price, {
        type: 'wizard',
        payload: { wizardType: 'vpn', wizardPlan, price, name },
      });
      return;
    }

    try {
      const res = await miniApiFetch('/subscription/create', {
        method: 'POST',
        body: JSON.stringify({
          user_id: currentUserId,
          ...buildPlanPayload(wizardPlan, 0),
          ...(wizardPlan.isTrial ? { is_trial: true } : {}),
        }),
      });

      if (res && res.success) {
        if (wizardPlan.isTrial) setIsTrialUsed(true);
        await refreshAll();
        setWizardStep(3);
      } else {
        alert(res?.error || 'Не удалось активировать подписку');
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка при активации подписки');
    }
  };

  const getPaymentTotal = () => {
    if (!selectedMethod) return checkoutAmount;
    const method = paymentMethods.find(m => m.id === selectedMethod);
    if (!method) return checkoutAmount;
    const feeAmount = checkoutAmount * (method.feePercent / 100);
    return checkoutAmount + feeAmount;
  };

  const referralLink = useMemo(() => {
    if (!telegramId) return '';
    if (fromTelegram) {
      return `https://t.me/${BOT_USERNAME_MINI}?start=ref${telegramId}`;
    }
    const base = `${window.location.origin}${window.location.pathname}`.replace(/\/$/, '');
    return `${base}?ref=${telegramId}`;
  }, [telegramId, fromTelegram]);

  const withdrawPreviewRub = Number(withdrawAmount) || 0;
  const withdrawPreviewUsdt = rubToUsdt(withdrawPreviewRub);

  const submitReferralWithdraw = async () => {
    if (!telegramId) return;
    const amount = Math.round(Number(withdrawAmount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < MIN_REFERRAL_WITHDRAW_RUB) {
      alert(`Минимальная сумма вывода — ${MIN_REFERRAL_WITHDRAW_RUB}₽`);
      return;
    }
    if (amount > MAX_REFERRAL_WITHDRAW_RUB) {
      alert(`Максимальная сумма вывода — ${MAX_REFERRAL_WITHDRAW_RUB}₽`);
      return;
    }
    if (amount > referrals.balance) {
      alert('Недостаточно средств на балансе');
      return;
    }
    const wallet = withdrawWallet.trim();
    if (!isTonWithdrawRecipient(wallet)) {
      alert('Введите UQ/EQ адрес, домен .ton, .t.me или @username');
      return;
    }

    setWithdrawing(true);
    try {
      const res = await miniApiFetch('/user/withdraw', {
        method: 'POST',
        body: JSON.stringify({
          telegram_id: telegramId,
          amount,
          method: 'ton_usdt',
          crypto_net: 'TON',
          crypto_addr: wallet,
        }),
      });
      if (res?.success) {
        alert(res.message || 'Заявка на вывод принята');
        setWithdrawModalOpen(false);
        setWithdrawAmount('');
        setWithdrawWallet('');
        await refreshUserData();
      } else {
        alert(res?.error || 'Не удалось оформить вывод');
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Ошибка при выводе средств');
    } finally {
      setWithdrawing(false);
    }
  };

  const HomeView = () => {
    const subscription = primarySubscription;

    return (
      <div className="pb-24">
        {}
        <div className="flex items-center justify-between py-6 px-4">
          <div>
            <div className="text-2xl font-bold text-white mb-1">Привет, {displayName}</div>
            <div className="text-sm text-gray-500">Добро пожаловать в {APP_NAME}</div>
          </div>
        </div>

        {}
        <div className="px-4 space-y-5">
          {showTrialPromo && (
            <>
              <TrialPromoBanner />
              <button
                onClick={openPurchaseWizard}
                className="w-full py-1 text-sm text-gray-400 hover:text-gray-300 transition-colors text-center"
              >
                Выбрать платный тариф →
              </button>
            </>
          )}

          {(promoDiscountPercent > 0 || promoSubscriptionDays != null) && (
            <div className="bg-purple-500/10 rounded-2xl p-4 border border-purple-500/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
                  <Gift size={20} className="text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  {promoDiscountPercent > 0 && (
                    <div className="text-white font-semibold text-sm">Скидка {promoDiscountPercent}% на тарифы</div>
                  )}
                  {promoSubscriptionDays != null && (
                    <div className="text-xs text-purple-300 mt-0.5">
                      Промокод: {promoSubscriptionDays} дн. подписки — активируйте в разделе «Промокод»
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {}
          {(subscription || !showTrialPromo) && (
            <div className="space-y-3">
              {!subscription ? (
                <button
                  onClick={openPurchaseWizard}
                  className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-4 rounded-2xl transition-colors"
                >
                  Купить подписку
                </button>
              ) : (
                <div className="bg-white/5 rounded-2xl p-4 border border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                      <Smartphone size={18} className="text-white" />
                    </div>
                    <div>
                      <div className="text-white font-semibold text-sm">
                        {subscription.is_trial ? 'Пробная подписка' : 'Подписка'}
                        {subscription.short_uuid ? ` #${subscription.short_uuid}` : ''}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${!subscription.is_expired ? 'bg-emerald-400' : 'bg-red-400'}`} />
                        <span className="text-xs text-gray-400">
                          {subscription.is_expired ? 'Истекла' :
                           subscription.days_left != null && subscription.days_left > 0 ? `${subscription.days_left} дн.` :
                           subscription.hours_left != null && subscription.hours_left > 0 ? `${subscription.hours_left} ч.` : 'Активна'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                {!subscription.is_expired && (
                  <button
                    onClick={() => openDeviceSetup(subscription)}
                    className="w-full py-2.5 text-sm font-medium bg-white/5 hover:bg-white/10 text-white rounded-xl border border-white/10"
                  >
                    Настроить устройство
                  </button>
                )}
                {deviceNeedsRenew(subscription) && (
                  <button
                    onClick={() => openDeviceRenew(subscription)}
                    className="w-full py-2.5 text-sm font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-xl border border-amber-500/30"
                  >
                    Продлить
                  </button>
                )}
              </div>
            )}
            </div>
          )}

          {}
          {referrals.balance > 0 && (
            <div className="bg-gradient-to-r from-emerald-500/10 to-blue-500/10 rounded-2xl p-4 border border-emerald-500/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-400 mb-1">Реферальный баланс</div>
                  <div className="text-2xl font-bold text-emerald-400">{formatMoney(referrals.balance)}</div>
                </div>
                <button
                  onClick={() => setView('referral')}
                  className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-semibold rounded-xl transition-colors border border-emerald-500/30"
                >
                  Подробнее
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const WizardView = () => (
    <div className="pb-24">
      <Header
        title={
            wizardStep === 1 ? "Выбор тарифа" :
            wizardStep === 2 ? "Подтверждение" : "Настройка"
        }
        onBack={() => {
            if (wizardStep === 1) {
              setView('home');
            } else if (wizardStep === 2 && promoSubscriptionDays != null && wizardPlan?.id === 'promo_sub') {
              setWizardPlan(null);
              setWizardStep(1);
            } else {
              setWizardStep(prev => prev - 1);
            }
        }}
      />

      {wizardStep === 1 && (
        <div className="px-4 space-y-4">
            {!isTrialUsed && trialPlan && (
              <button
                onClick={() => { setWizardPlan(trialPlan); setWizardStep(2); }}
                className="w-full px-4 py-3.5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-between"
              >
                <span className="text-white font-medium">Пробная · 7 дней</span>
                <span className="text-white font-semibold">1 ₽</span>
              </button>
            )}

            <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/10">
              <button
                onClick={() => setWizardTariffTab('regular')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  wizardTariffTab === 'regular' ? 'bg-white/10 text-white' : 'text-gray-500'
                }`}
              >
                Обычный
              </button>
              <button
                onClick={() => setWizardTariffTab('family')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  wizardTariffTab === 'family' ? 'bg-white/10 text-white' : 'text-gray-500'
                }`}
              >
                Семейный
              </button>
            </div>

            <div className="text-xs text-gray-500 px-1">
              {wizardTariffTab === 'regular' ? 'До 2 устройств' : 'До 5 устройств'}
            </div>

            <div className="space-y-2">
              {paidPlansByCategory(wizardTariffTab).map((plan) => {
                const showDisc = promoDiscountPercent > 0 && plan.price > 0;
                const eff = priceAfterPromoDiscount(plan.price);
                return (
                  <button
                    key={plan.id}
                    onClick={() => { setWizardPlan(plan); setWizardStep(2); }}
                    className="w-full px-4 py-3.5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-between"
                  >
                    <span className="text-white font-medium">{plan.duration}</span>
                    <div className="text-right">
                      <span className="text-white font-semibold">{showDisc ? eff : plan.price} ₽</span>
                      {showDisc && (
                        <div className="text-xs text-gray-500 line-through">{plan.price} ₽</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
        </div>
      )}

      {wizardStep === 2 && (
        <div className="px-4 space-y-6">
            <div className="bg-white/5 rounded-3xl p-6 border border-white/10 text-center">
                <div className="text-gray-400 text-sm mb-2">Тариф</div>
                <div className="text-2xl font-bold text-white mb-1">
                    {wizardPlan?.isTrial ? 'Пробная подписка' : wizardPlan?.duration}
                </div>
                {!wizardPlan?.isTrial && (
                  <div className="text-sm text-gray-500 mb-6">
                    {wizardPlan?.tariffCategory === 'family' ? 'Семейный' : 'Обычный'} · до {wizardPlan?.devicesLimit ?? 2} устройств
                  </div>
                )}
                {wizardPlan?.isTrial && (
                  <div className="text-sm text-gray-500 mb-6">7 дней · до 2 устройств</div>
                )}

                <div className="border-t border-white/10 pt-4 flex justify-between items-center">
                    <span className="text-gray-400">Стоимость:</span>
                    <div className="text-right">
                    <span className="text-xl font-bold text-white">
                        {wizardPlan?.id === 'promo_sub' ? '0' : (wizardPlan && !wizardPlan.isTrial && promoDiscountPercent > 0 && wizardPlan.price > 0
                          ? priceAfterPromoDiscount(wizardPlan.price)
                          : (wizardPlan?.price ?? 0))} ₽
                    </span>
                    {wizardPlan && !wizardPlan.isTrial && wizardPlan.id !== 'promo_sub' && promoDiscountPercent > 0 && wizardPlan.price > 0 && (
                      <div className="text-sm text-gray-500 line-through">{wizardPlan.price} ₽</div>
                    )}
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <Button onClick={wizardActivate} variant={wizardPlan?.isTrial || (wizardPlan?.price === 0) || wizardPlan?.id === 'promo_sub' ? 'trial' : 'primary'}>
                    {wizardPlan?.id === 'promo_sub' || (wizardPlan?.price === 0 && !wizardPlan?.isTrial)
                      ? 'Активировать бесплатно'
                      : wizardPlan?.isTrial
                        ? `Оплатить ${wizardPlan.price} ₽`
                        : `Оплатить ${priceAfterPromoDiscount(wizardPlan?.price || 0)} ₽`}
                </Button>
            </div>
        </div>
      )}

      {wizardStep === 3 && (
        <div className="flex-1 flex flex-col h-full animate-fade-in">
            <div className="text-center mb-6">
                <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center text-green-500 mx-auto mb-4 animate-scale-in">
                    <CheckCircle size={32} />
                </div>
                <h2 className="text-2xl font-bold text-white animate-slide-up">Успешно!</h2>
                <p className="text-slate-400 animate-slide-up" style={{ animationDelay: '0.1s' }}>Подписка активирована. Настройте ваше устройство:</p>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-800/50 rounded-2xl p-4 border border-slate-700">
                {INSTRUCTIONS[wizardPlatform].steps.map((step, idx) => (
                    <div key={idx} className="relative pl-6 border-l-2 border-slate-700 pb-6 last:border-0 last:pb-0">
                        <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-slate-900 border-2 border-blue-500"></div>
                        <h3 className="font-bold text-white text-md mb-1 leading-none">{step.title}</h3>
                        <p className="text-slate-400 text-xs mb-3 leading-relaxed">{step.desc}</p>

                        {step.actions && (
                            <div className="flex flex-col gap-2">
                            {step.actions.map((action, aIdx) => (
                                <button
                                key={aIdx}
                                onClick={async () => {
                                    if (action.type === 'copy_key') {

                                        const activeDevice = devices.find(d => d.id);
                                        if (activeDevice && deviceKeys.has(activeDevice.id)) {
                                            handleCopy('', activeDevice.id);
                                        } else {
                                            alert('Ключ подписки не найден. Обновите страницу.');
                                        }
                                    } else if (action.type === 'trigger_add') {

                                        await openHappWithSubscription();
                                    } else if (action.url) {
                                        window.open(action.url, '_blank');
                                    }
                                }}
                                className={`py-2 px-3 rounded-lg text-xs font-semibold text-center transition-colors ${
                                    action.primary
                                    ? 'bg-blue-600 text-white hover:bg-blue-500'
                                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                }`}
                                >
                                {action.label}
                                </button>
                            ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <Button className="mt-4" variant="secondary" onClick={() => setView('home')}>
                На главную
            </Button>
        </div>
      )}
    </div>
  );

  const DevicesView = () => {
    const subscription = primarySubscription;
    const isActive = subscription && !subscription.is_expired;
    const isExpired = subscription?.is_expired;

    const remainingDisplay = !subscription
      ? ''
      : isExpired
      ? '0 дн.'
      : subscription.days_left != null && subscription.days_left > 0
      ? `${subscription.days_left} дн.`
      : subscription.hours_left != null && subscription.hours_left > 0
      ? `${subscription.hours_left} ч.`
      : 'Активна';
    const remainingCaption = isExpired ? 'требуется продление' : 'осталось';

    return (
      <div className="pb-24">
        <div className="py-6 px-4">
          <h1 className="text-2xl font-bold text-white">Моя подписка</h1>
          <p className="text-sm text-gray-500 mt-1">
            {!subscription
              ? 'Подключите VPN за пару минут'
              : isExpired
              ? 'Продлите подписку, чтобы продолжить'
              : 'Настройка и управление доступом'}
          </p>
        </div>

        <div className="px-4 space-y-4">
          {!subscription ? (
            <>
              {showTrialPromo ? (
                <>
                  <TrialPromoBanner />
                  <button
                    onClick={openPurchaseWizard}
                    className="w-full py-1 text-sm text-gray-400 hover:text-gray-300 transition-colors text-center"
                  >
                    Выбрать платный тариф →
                  </button>
                </>
              ) : (
                <div className="bg-white/5 rounded-3xl border border-white/10 p-8 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-blue-500/15 flex items-center justify-center mx-auto mb-5">
                    <Sparkles size={28} className="text-blue-400" />
                  </div>
                  <h2 className="text-lg font-semibold text-white mb-2">Нет активной подписки</h2>
                  <p className="text-sm text-gray-400 mb-6 max-w-xs mx-auto">
                    Выберите тариф и получите быстрый доступ к VPN на всех устройствах
                  </p>
                  <button
                    onClick={openPurchaseWizard}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3.5 rounded-2xl transition-colors"
                  >
                    Купить подписку
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black">
              <div
                className="pointer-events-none absolute inset-0 opacity-15"
                style={{
                  backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              />
              <div className="relative p-5 space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                      isExpired ? 'bg-red-500/15' : 'bg-emerald-500/15'
                    }`}>
                      <Shield size={22} className={isExpired ? 'text-red-400' : 'text-emerald-400'} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-white font-semibold truncate">
                        {subscription.is_trial ? 'Пробная подписка' : 'Подписка'}
                        {subscription.short_uuid ? ` #${subscription.short_uuid}` : ''}
                      </div>
                      {subscription.expiry_date && (
                        <div className="text-xs text-gray-500 mt-0.5">до {subscription.expiry_date}</div>
                      )}
                    </div>
                  </div>
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
                    isExpired
                      ? 'bg-red-500/15 text-red-300 border border-red-500/25'
                      : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                  }`}>
                    {isExpired ? 'Истекла' : 'Активна'}
                  </span>
                </div>

                <div className="text-center py-2">
                  <div className={`text-4xl font-bold leading-none ${
                    isExpired ? 'text-red-400' : 'text-white'
                  }`}>
                    {remainingDisplay}
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    {remainingCaption}
                  </div>
                </div>

                <div className="space-y-2.5">
                  {isActive && (
                    <button
                      onClick={() => openDeviceSetup(subscription)}
                      className="w-full py-3.5 rounded-2xl bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm transition-colors"
                    >
                      Настроить устройство
                    </button>
                  )}
                  {deviceNeedsRenew(subscription) && (
                    <button
                      onClick={() => openDeviceRenew(subscription)}
                      className={`w-full py-3.5 rounded-2xl font-semibold text-sm transition-colors ${
                        isExpired
                          ? 'bg-amber-500 hover:bg-amber-600 text-white'
                          : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      Продлить подписку
                    </button>
                  )}
                  <button
                    onClick={() => openDeleteModal(subscription)}
                    className="w-full py-2.5 text-xs text-gray-500 hover:text-red-400 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Trash2 size={14} />
                    Удалить подписку
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const ExtendSubscriptionView = () => {
    const plansForExtend = vpnPlans.filter(p => !p.isTrial);

    return (
      <div className="pb-24">
        <Header
          title="Продление подписки"
          onBack={() => {
            setExtendingDevice(null);
            setExtendPlan(null);
            setView('devices');
          }}
        />

        <div className="px-4 space-y-4">
          {extendingDevice && (
            <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
              <div className="text-gray-500 text-xs mb-1">Продление</div>
              <div className="text-white font-medium">
                {extendingDevice.is_trial ? 'Пробная подписка' : 'Подписка'}
                {extendingDevice.short_uuid ? ` #${extendingDevice.short_uuid}` : ''}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {plansForExtend.map(plan => {
              const extEff = priceAfterPromoDiscount(plan.price);
              const extDisc = promoDiscountPercent > 0 && plan.price > 0;
              return (
              <button
                key={plan.id}
                onClick={() => setExtendPlan(plan)}
                className={`w-full px-4 py-3.5 rounded-2xl text-left transition-colors border flex items-center justify-between ${
                  extendPlan?.id === plan.id
                    ? 'bg-white/10 border-white/20'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <div>
                  <div className="text-white font-medium">{plan.duration}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {plan.tariffCategory === 'family' ? 'Семейный' : 'Обычный'}
                  </div>
                  {extDisc && (
                    <div className="text-xs text-gray-500 mt-0.5 line-through">{plan.price} ₽</div>
                  )}
                </div>
                <div className="text-white font-semibold">{extDisc ? extEff : plan.price} ₽</div>
              </button>
            );})}
          </div>

          <Button
            disabled={!extendPlan || !extendingDevice}
            onClick={() => {
              if (extendPlan && extendingDevice) {
                extendSubscription(extendingDevice, extendPlan);
              }
            }}
          >
            Продлить за {extendPlan ? priceAfterPromoDiscount(extendPlan.price) : 0} ₽
          </Button>
        </div>
      </div>
    );
  };

  const CheckoutView = () => (
    <div className="pb-24">
      <Header
        title="Оплата"
        onBack={() => {
          if (pendingAction?.type === 'wizard') setView('wizard');
          else if (pendingAction?.type === 'extend') setView('extend_subscription');
          else setView('home');
        }}
      />

      <div className="px-4 space-y-6">
        <div className="bg-white/5 rounded-3xl p-6 border border-white/10">
          <div className="space-y-3 mb-6">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">К оплате:</span>
              <span className="text-white font-semibold">{checkoutAmount} ₽</span>
            </div>
            {selectedMethod && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">Комиссия ({paymentMethods.find(m => m.id === selectedMethod)?.feePercent ?? 0}%):</span>
                <span className="text-gray-300">+{
                  (() => {
                    const total = getPaymentTotal();
                    return (total - checkoutAmount).toFixed(1).replace(/\.0$/, '');
                  })()
                } ₽</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-3 border-t border-white/10 font-bold text-lg">
              <span className="text-white">Итого:</span>
              <span className="text-blue-400">{getPaymentTotal()} ₽</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm text-gray-400 px-1">Выберите способ оплаты</div>
          {paymentMethods.map(method => (
            <div key={method.id}>
              <button
                onClick={() => setSelectedMethod(method.id)}
                className={`w-full p-4 rounded-2xl flex items-center justify-between transition-colors border ${
                  selectedMethod === method.id
                  ? 'bg-blue-500/20 border-blue-500 text-white'
                  : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{method.icon}</span>
                  <div className="text-left">
                    <div className="font-semibold">{method.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {method.feePercent === 0 ? 'Без комиссии' : `Комиссия ${method.feePercent}%`}
                    </div>
                  </div>
                </div>
                {selectedMethod === method.id && <CheckCircle size={20} className="text-blue-400" />}
              </button>
            </div>
          ))}
        </div>

        <Button
          disabled={!selectedMethod}
          onClick={async () => {
            if (!userId) {
              alert('Пользователь не загружен, попробуйте позже');
              return;
            }
            try {
              const total = getPaymentTotal();
              const methodKey = selectedMethod || 'lava_sbp';

              const res = await miniApiFetch('/payment/create', {
                method: 'POST',
                body: JSON.stringify({
                  user_id: userId,
                  amount: total,
                  method: methodKey
                }),
              });

              const payUrl = res.confirmation_url || res.payment_url;
              if (payUrl) {
                setPaymentUrl(payUrl);
                try {
                  if (window.Telegram?.WebApp?.openLink) {
                    window.Telegram.WebApp.openLink(payUrl);
                  } else {
                    window.open(payUrl, '_blank');
                  }
                } catch {
                  window.open(payUrl, '_blank');
                }
              }
              setView('wait_payment');
            } catch (e) {
              console.error(e);
              alert('Не удалось создать платёж, попробуйте позже');
            }
          }}
        >
          Оплатить {getPaymentTotal()} ₽
        </Button>
      </div>
    </div>
  );

  const PaymentWaitView = () => {
    const [checking, setChecking] = useState(false);
    const [pollingActive, setPollingActive] = useState(false);
    const checkingRef = useRef(false);

    const doPaymentCheck = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      setChecking(true);

      try {
        const oldBalance = balance;
        const result = await refreshUserData();
        const newBalance = result?.balance ?? oldBalance;

        if (newBalance > oldBalance) {
          setPollingActive(false);

          if (pendingAction) {
            const action = pendingAction;
            const payload = action.payload;

            if (newBalance >= payload.price) {
              try {
                const currentUserId = await ensureUserId();
                if (currentUserId) {
                  if (action.type === 'extend' && payload.device && payload.plan) {
                    const res = await miniApiFetch('/subscription/extend', {
                      method: 'POST',
                      body: JSON.stringify({
                        user_id: currentUserId,
                        key_id: payload.device.id,
                        days: payload.plan.days,
                        price: payload.price,
                      }),
                    });

                    if (res && res.success) {
                      setPendingAction(null);
                      setPaymentUrl(null);
                      setExtendingDevice(null);
                      setExtendPlan(null);
                      await refreshAll();
                      setView('devices');
                      alert('Подписка успешно продлена!');
                      return;
                    }
                  } else {
                    const plan = payload.wizardPlan as Plan;
                    const res = await miniApiFetch('/subscription/create', {
                      method: 'POST',
                      body: JSON.stringify({
                        user_id: currentUserId,
                        ...buildPlanPayload(plan, payload.price),
                        ...(plan?.isTrial ? { is_trial: true } : {}),
                      }),
                    });

                    if (res && res.success) {
                      if (plan?.isTrial) setIsTrialUsed(true);
                      setPendingAction(null);
                      setPaymentUrl(null);
                      setActivePlatform(wizardPlatform);
                      await refreshAll();
                      setWizardStep(3);
                      setView('wizard');
                      return;
                    }
                  }
                }
              } catch (e) {
                console.error('Failed to process pending action after payment', e);
              }
            }

            setPendingAction(null);
            setPaymentUrl(null);
            alert('Оплата получена, но не удалось активировать подписку. Обратитесь в поддержку.');
            setView('home');
          }
        }
      } finally {
        checkingRef.current = false;
        setChecking(false);
      }
    };

    useEffect(() => {
      if (!pollingActive) return;

      const interval = setInterval(() => {
        doPaymentCheck();
      }, 3000);

      return () => clearInterval(interval);
    }, [pollingActive]);

    useEffect(() => {
      setPollingActive(true);
      return () => setPollingActive(false);
    }, []);

    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] animate-in zoom-in duration-300 text-center px-4">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-600/20 to-purple-600/20 flex items-center justify-center mb-8 relative">
          <div className="absolute inset-0 rounded-full border-4 border-blue-500/50 border-t-blue-500 animate-spin"></div>
          <div className="absolute inset-2 rounded-full border-4 border-purple-500/30 border-b-purple-500 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
          <CreditCard className="text-blue-400" size={32} />
        </div>
        <h2 className="text-2xl font-bold text-white mb-3">Обрабатываем платёж...</h2>
        <p className="text-slate-400 mb-2 max-w-xs">
          Подписка активируется автоматически после оплаты
        </p>
        <p className="text-slate-500 text-xs mb-8">
          Страница обновится автоматически
        </p>
        {paymentUrl && (
          <Button onClick={() => {
            try {
              if (window.Telegram?.WebApp?.openLink) {
                window.Telegram.WebApp.openLink(paymentUrl);
              } else {
                window.open(paymentUrl, '_blank');
              }
            } catch {
              window.open(paymentUrl, '_blank');
            }
          }}>
            <ExternalLink size={18} className="mr-2" />
            Перейти к оплате
          </Button>
        )}
        <div className="mt-4 text-xs text-slate-500">
          {checking ? 'Проверка оплаты...' : 'Автоматическая проверка каждые 3 сек.'}
        </div>
        <button
          onClick={() => window.open(SUPPORT_URL, '_blank')}
          className="mt-4 text-blue-500 text-sm hover:text-blue-300 font-medium flex items-center gap-2"
        >
          <MessageCircle size={16} /> Связаться с поддержкой
        </button>
        <button onClick={() => { setPaymentUrl(null); setPendingAction(null); setPollingActive(false); setView('home'); }} className="mt-3 text-slate-500 text-sm hover:text-slate-300">
          Отменить
        </button>
      </div>
    );
  };

  const InstructionView = () => {
    const currentInstr = INSTRUCTIONS[activePlatform] || INSTRUCTIONS['android'];

    return (
      <div className="pb-24">
        <Header title="Настройка" onBack={() => { setInstructionDeviceId(null); setView('devices'); }} />

        <div className="px-4 space-y-5">
          {}
          <div className="bg-white/5 rounded-3xl p-4 border border-white/10">
            <label className="text-xs text-gray-400 mb-2 block">Платформа</label>
            <div className="relative">
              <select
                value={activePlatform}
                onChange={(e) => setActivePlatform(e.target.value as PlatformId)}
                className="w-full appearance-none bg-white/5 border border-white/10 text-white py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:border-blue-500 transition-colors"
              >
                {Object.entries(INSTRUCTIONS).map(([key, data]) => (
                  <option key={key} value={key}>{data.title}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                <ChevronDown size={18} />
              </div>
            </div>
          </div>

          {}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-3xl p-4 flex gap-3">
            <div className="text-blue-400 mt-0.5"><CheckCircle size={20} /></div>
            <div>
              <div className="font-semibold text-blue-400 text-sm mb-1">Устройство готово</div>
              <div className="text-blue-400/70 text-xs">Следуйте инструкции ниже для подключения</div>
            </div>
          </div>

          {}
          <div className="space-y-4">
            {currentInstr.steps.map((step, idx) => (
              <div key={idx} className="bg-white/5 rounded-3xl p-5 border border-white/10">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-sm flex-shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-white text-base mb-2">{step.title}</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">{step.desc}</p>
                  </div>
                </div>

                {step.actions && (
                  <div className="flex flex-col gap-2 mt-4">
                    {step.actions.map((action, aIdx) => (
                      <button
                        key={aIdx}
                        onClick={async () => {
                          if (action.type === 'copy_key') {
                            const targetId = instructionDeviceId ?? devices.find(d => deviceKeys.has(d.id))?.id;
                            if (targetId != null && deviceKeys.has(targetId)) {
                              handleCopy('', targetId);
                            } else {
                              alert('Ключ подписки не найден. Обновите страницу.');
                            }
                          } else if (action.type === 'nav_android') {
                            setActivePlatform('android');
                          } else if (action.type === 'nav_ios') {
                            setActivePlatform('ios');
                          } else if (action.type === 'trigger_add') {
                            await openHappWithSubscription(instructionDeviceId ?? undefined);
                          } else if (action.url) {
                            window.open(action.url, '_blank');
                          }
                        }}
                        className={`py-3 px-4 rounded-xl text-sm font-semibold text-center transition-colors ${
                          action.primary
                          ? 'bg-blue-500 hover:bg-blue-600 text-white'
                          : 'bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10'
                        }`}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const ReferralDetailView = () => {
    if (!selectedReferral) return null;
    return (
     <div className="pb-24">
        <Header title={selectedReferral.name} />

        <div className="px-4 space-y-6">
          <div className="grid grid-cols-2 gap-3">
             <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                <div className="text-xs text-gray-400 mb-1">Потратил всего</div>
                <div className="text-xl font-bold text-white">{formatMoney(selectedReferral.spent)}</div>
             </div>
             <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                <div className="text-xs text-gray-400 mb-1">Вы получили</div>
                <div className="text-xl font-bold text-emerald-400">+{formatMoney(selectedReferral.myProfit)}</div>
             </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm text-gray-400 px-1">История операций</div>
            {selectedReferral.history.length > 0 ? selectedReferral.history.map((h, idx) => (
              <div key={idx} className="bg-white/5 p-4 rounded-2xl border border-white/10 flex justify-between items-center">
                 <div>
                    <div className="font-semibold text-white text-sm">{h.title}</div>
                    <div className="text-xs text-gray-400 mt-1">{h.date}</div>
                 </div>
                 <div className="text-right">
                    <div className="text-white font-semibold">{formatMoney(h.amount)}</div>
                    <div className="text-xs text-emerald-400 font-bold mt-1">+{formatMoney(h.income)}</div>
                 </div>
              </div>
           )) : (
              <div className="text-center py-12 bg-white/5 rounded-2xl border border-white/10">
                <div className="text-gray-500 text-sm">Нет операций</div>
              </div>
           )}
          </div>
        </div>
     </div>
    );
  };

  const ReferralView = () => {
    return (
    <div className="pb-24">
      <Header title="Реферальная программа" />

      <div className="px-4 space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center mb-3">
              <CreditCard size={20} className="text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-400">{formatMoney(referrals.balance)}</div>
            <div className="text-xs text-gray-400 mt-1">Баланс</div>
          </div>

          <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center mb-3">
              <UserPlus size={20} className="text-blue-400" />
            </div>
            <div className="text-2xl font-bold text-white">{referrals.count}</div>
            <div className="text-xs text-gray-400 mt-1">Приглашено</div>
          </div>
        </div>

        <button
          onClick={() => referrals.balance > 0 && setWithdrawModalOpen(true)}
          disabled={referrals.balance <= 0}
          className={`w-full py-3.5 rounded-2xl text-white font-semibold transition-colors ${
            referrals.balance > 0
              ? 'bg-blue-500 hover:bg-blue-600'
              : 'bg-gray-600 cursor-not-allowed opacity-50'
          }`}
        >
          Вывод средств
        </button>

        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
          <label className="text-xs text-gray-400 mb-2 block">Ваша реферальная ссылка</label>
          <div className="flex gap-2">
            <div className="bg-white/5 flex-1 p-3 rounded-xl text-gray-300 font-mono text-xs truncate border border-white/10">
              {referralLink || 'Загрузка...'}
            </div>
            <button
              onClick={() => referralLink && handleCopy(referralLink)}
              disabled={!referralLink}
              className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 px-4 rounded-xl text-white transition-colors"
            >
              <Copy size={18} />
            </button>
          </div>
          <div className="text-xs text-gray-500 mt-3">
            {fromTelegram
              ? 'Ссылка ведёт в бота. Друг может также зайти через сайт по ?ref='
              : 'Ссылка ведёт на сайт. Друг может также зайти через бота'}
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm text-gray-400 px-1">Приглашённые пользователи</div>
          {referralList.length === 0 ? (
            <div className="text-center py-12 bg-white/5 rounded-2xl border border-white/10">
              <UserPlus size={32} className="text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">У вас пока нет рефералов</p>
              <p className="text-gray-600 text-xs mt-1">Поделитесь ссылкой выше</p>
            </div>
          ) : (
            referralList.map(user => (
              <button
                 key={user.id}
                 onClick={() => { setSelectedReferral(user); setView('referral_detail'); }}
                 className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl flex justify-between items-center hover:bg-white/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-gray-400">
                    <User size={18} />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold text-white">{user.name}</div>
                    <div className="text-xs text-gray-400">{user.date}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                   <div className="text-right">
                     <div className="text-xs text-gray-400">Доход</div>
                     <div className="text-sm font-bold text-emerald-400">+{formatMoney(user.myProfit)}</div>
                   </div>
                   <ChevronRight size={18} className="text-gray-400" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
    );
  };

  const PromoView = () => {
    const [code, setCode] = useState('');
    return (
      <div className="pb-24">
        <div className="px-4 space-y-6">
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center text-purple-400 mx-auto mb-4">
              <Gift size={32} />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Активация промокода</h2>
            <p className="text-gray-400 text-sm">
              Введите промокод для получения бонуса
            </p>
          </div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="PROMO2025"
            className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-center text-xl font-mono text-white tracking-widest uppercase focus:border-purple-500 focus:outline-none placeholder:text-gray-600"
          />
          <Button
            disabled={!code}
            onClick={async () => {
              if (!userId) {
                alert('Пользователь не загружен, попробуйте позже');
                return;
              }
              try {
                const res = await miniApiFetch('/promocode/apply', {
                  method: 'POST',
                  body: JSON.stringify({ user_id: userId, code }),
                });
                if (res.success) {
                  if (res.open_wizard_subscription && res.pending_subscription_days) {
                    const d = Number(res.pending_subscription_days);
                    const promoDays = Number.isFinite(d) && d > 0 ? d : null;
                    setPromoSubscriptionDays(promoDays);
                    openPurchaseWizard(promoDays);
                    alert(res.message || 'Подтвердите активацию подписки');
                  } else {
                    alert(res.message || 'Промокод успешно применён');
                  }
                  if (telegramId) {
                    const data = await miniApiFetch(`/user/info?telegram_id=${telegramId}`);
                    setBalance(data.balance ?? balance);
                    const disc = Number(data.promo_discount_percent);
                    setPromoDiscountPercent(Number.isFinite(disc) && disc > 0 ? disc : 0);
                    const pend = data.pending_promo_days;
                    if (pend != null && Number(pend) > 0) {
                      setPromoSubscriptionDays(Number(pend));
                    }
                    setReferrals({
                      count: data.referrals_count ?? referrals.count,
                      balance: data.referral_balance ?? data.partner_balance ?? referrals.balance,
                    });
                  }
                } else {
                  alert(res.error || 'Промокод не найден');
                }
              } catch (e) {
                console.error(e);
                alert('Ошибка применения промокода');
              } finally {
                setCode('');
              }
            }}
          >
            Активировать
          </Button>
        </div>
      </div>
    );
  };

  if (needsLogin && !telegramId && !isBanned) {
    return (
      <div className="max-w-md mx-auto bg-black min-h-screen relative text-white font-sans selection:bg-blue-500/30">
        <div className="p-6 min-h-screen flex flex-col items-center justify-center">
          <div className="w-full max-w-sm text-center animate-in fade-in duration-500">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
              <Shield size={36} className="text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">{APP_NAME}</h1>
            <p className="text-slate-400 mb-8 leading-relaxed">
              Войдите через Telegram, чтобы управлять подпиской с сайта.
            </p>

            <div className="flex justify-center mb-4 min-h-[48px]">
              <div ref={telegramWidgetRef} />
            </div>

            {authLoading && (
              <p className="text-sm text-slate-400">Авторизация…</p>
            )}
            {authError && (
              <p className="text-sm text-red-400 mt-3">{authError}</p>
            )}

            <div className="mt-10 pt-6 border-t border-slate-800">
              <p className="text-xs text-slate-500 mb-3">Или откройте приложение в Telegram</p>
              <a
                href={`https://t.me/${BOT_USERNAME_MINI}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
              >
                <ExternalLink size={14} />
                Открыть @{BOT_USERNAME_MINI}
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isBanned) {
    return (
      <div className="max-w-md mx-auto bg-black min-h-screen relative text-white font-sans selection:bg-blue-500/30">
        <div className="p-4 min-h-screen flex flex-col items-center justify-center">
          <div className="text-center px-4 animate-in fade-in duration-500">
            {}
            <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
              <svg className="w-12 h-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>

            {}
            <h1 className="text-2xl font-bold text-white mb-3">Доступ ограничен</h1>

            {}
            <p className="text-slate-400 mb-6 leading-relaxed">
              Ваш аккаунт заблокирован за нарушение правил сервиса.
            </p>

            {}
            {banReason && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
                <div className="text-sm text-red-400 font-medium mb-1">Причина:</div>
                <div className="text-white text-sm">{banReason}</div>
              </div>
            )}

            {}
            <div className="bg-slate-800/50 rounded-xl p-4 mb-6 text-left">
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Информация
              </h3>
              <ul className="text-sm text-slate-400 space-y-2">
                <li>• Администрация оставляет за собой право отказать в разблокировке</li>
                <li>• Подробности о причинах блокировки могут не предоставляться в целях защиты алгоритмов безопасности</li>
              </ul>
            </div>

            {}
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl text-white font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              Связаться с поддержкой
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-black min-h-screen relative text-white font-sans selection:bg-blue-500/30">
      <div className="p-4 min-h-screen flex flex-col">
        {view === 'home' && <HomeView />}
        {view === 'wizard' && <WizardView />}
        {view === 'checkout' && <CheckoutView />}
        {view === 'wait_payment' && <PaymentWaitView />}
        {view === 'devices' && <DevicesView />}
        {view === 'extend_subscription' && <ExtendSubscriptionView />}
        {view === 'instruction_view' && <InstructionView />}
        {view === 'referral' && <ReferralView />}
        {view === 'referral_detail' && <ReferralDetailView />}
        {view === 'promo' && <PromoView />}
      </div>

      {}
      <div className="fixed bottom-0 left-0 right-0 z-20 max-w-md mx-auto px-4 pb-4 pt-2 pointer-events-none">
        <nav className="pointer-events-auto w-full rounded-full bg-zinc-900 shadow-[0_8px_32px_rgba(0,0,0,0.55)] px-2 py-2.5">
          <div ref={navGridRef} className="relative grid grid-cols-5 gap-0.5 items-stretch">
            {navIndicator && activeNavIndex >= 0 && (
              <div
                className="absolute top-0 bottom-0 bg-blue-500 rounded-full pointer-events-none transition-[left,width] duration-300 ease-out"
                style={{ left: navIndicator.left, width: navIndicator.width }}
              />
            )}
          {([
            {
              key: 'home',
              label: 'Главная',
              active: view === 'home',
              onClick: () => setView('home'),
              icon: (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
                </svg>
              ),
            },
            {
              key: 'referral',
              label: 'Рефералы',
              active: view === 'referral' || view === 'referral_detail',
              onClick: () => setView('referral'),
              icon: <UserPlus size={18} />,
            },
            {
              key: 'subscription',
              label: 'Подписка',
              active: view === 'devices' || view === 'wizard' || view === 'extend_subscription' || view === 'instruction_view',
              onClick: () => setView('devices'),
              icon: <Sparkles size={18} />,
            },
            {
              key: 'promo',
              label: 'Промокод',
              active: view === 'promo',
              onClick: () => setView('promo'),
              icon: <Gift size={18} />,
            },
            {
              key: 'support',
              label: 'Поддержка',
              active: false,
              onClick: () => window.open(SUPPORT_URL, '_blank'),
              icon: <MessageCircle size={18} />,
            },
          ] as const).map((item) => (
            <button
              key={item.key}
              data-nav-item
              onClick={item.onClick}
              className={`relative z-10 flex flex-col items-center justify-center gap-0.5 rounded-full w-full min-w-0 py-2 transition-colors duration-200 ${
                item.active ? 'text-white' : 'text-gray-500'
              }`}
            >
              {item.icon}
              <span className="text-[10px] font-medium leading-tight whitespace-nowrap">{item.label}</span>
            </button>
          ))}
          </div>
        </nav>
      </div>

      {}
      {view === 'home' && (
      <div className="fixed bottom-[5.5rem] left-0 right-0 max-w-md mx-auto px-4 py-2 z-10 pointer-events-none">
        <div className="pointer-events-auto flex items-center justify-center gap-4 text-xs text-gray-500">
          <button
            onClick={() => {
              setDocContent({ title: 'Договор оферты', text: publicPages.offer });
              setDocModalOpen(true);
            }}
            className="hover:text-blue-400 transition-colors"
          >
            Договор оферты
          </button>
          <span className="text-gray-600">•</span>
          <button
            onClick={() => {
              setDocContent({ title: 'Политика конфиденциальности', text: publicPages.privacy });
              setDocModalOpen(true);
            }}
            className="hover:text-blue-400 transition-colors"
          >
            Политика конфиденциальности
          </button>
        </div>
      </div>
      )}

      {}

      <Modal
        title="Удалить подписку"
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-slate-300">
            Вы уверены, что хотите удалить <b>{currentDevice?.name}</b>? Это действие нельзя отменить.
          </p>
          <div className="grid grid-cols-2 gap-3">
             <Button variant="secondary" onClick={() => setDeleteModalOpen(false)}>Отмена</Button>
             <Button variant="danger" onClick={confirmDeleteDevice}>Удалить</Button>
          </div>
        </div>
      </Modal>

      {}
      <Modal
        title={docContent?.title || 'Документ'}
        isOpen={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        fullHeight
      >
        <div className="pb-6">
            <MarkdownRenderer content={docContent?.text || ''} />
        </div>
      </Modal>

      <Modal
        title="Вывод средств"
        isOpen={withdrawModalOpen}
        onClose={() => !withdrawing && setWithdrawModalOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Вывод в USDT в сети <span className="text-white font-medium">TON</span>.
          </p>
          <div>
            <label className="text-xs text-gray-500 block mb-2">Сумма (₽)</label>
            <input
              type="number"
              min={MIN_REFERRAL_WITHDRAW_RUB}
              max={MAX_REFERRAL_WITHDRAW_RUB}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder={`${MIN_REFERRAL_WITHDRAW_RUB}–${MAX_REFERRAL_WITHDRAW_RUB}`}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white focus:border-blue-500 focus:outline-none"
            />
            <div className="text-xs text-gray-500 mt-2">
              Доступно: {formatMoney(referrals.balance)} · До {MAX_REFERRAL_WITHDRAW_RUB}₽
            </div>
          </div>
          {withdrawPreviewRub >= MIN_REFERRAL_WITHDRAW_RUB && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-sm text-emerald-300">
              Вы получите ≈ {withdrawPreviewUsdt} USDT
            </div>
          )}
          <div>
            <label className="text-xs text-gray-500 block mb-2">USDT-кошелёк (сеть TON)</label>
            <input
              value={withdrawWallet}
              onChange={(e) => setWithdrawWallet(e.target.value)}
              placeholder="UQ..., wallet.ton, user.t.me, @username"
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white font-mono text-sm focus:border-blue-500 focus:outline-none"
            />
            <div className="text-xs text-gray-500 mt-2">
              Адрес EQ/UQ, домен .ton, .t.me или @username Telegram
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button variant="secondary" disabled={withdrawing} onClick={() => setWithdrawModalOpen(false)}>
              Отмена
            </Button>
            <Button disabled={withdrawing || !withdrawAmount || !withdrawWallet} onClick={submitReferralWithdraw}>
              {withdrawing ? 'Отправка...' : 'Вывести'}
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}