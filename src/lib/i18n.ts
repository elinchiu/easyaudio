import { useSyncExternalStore } from 'react';
import { messages, type Lang, type MessageKey } from './messages';

export type { Lang, MessageKey };

// 與 public/terms.html、public/privacy.html 共用同一個 key，
// 這樣在任何一頁切換語言，其他頁面都會跟著用同一個語言。
const STORAGE_KEY = 'easyaudio_lang';

const isLang = (value: unknown): value is Lang => value === 'zh' || value === 'en';

function readStored(): Lang | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLang(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {}
}

// 優先順序：網址 ?lang=zh|en → 先前的選擇 → 瀏覽器語言（中文用中文，其他用英文）
function detectLang(): Lang {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (isLang(fromUrl)) {
      writeStored(fromUrl);
      return fromUrl;
    }
  } catch {}
  const stored = readStored();
  if (stored) return stored;
  return /^zh/i.test(navigator.language || '') ? 'zh' : 'en';
}

let current: Lang = detectLang();
const listeners = new Set<() => void>();

/**
 * 取得翻譯。可以在 React 之外使用（例如 lib、hooks 裡產生錯誤訊息時）。
 * 參數用 {name} 取代；有單複數的訊息會依 params.n 選擇。
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const entry = messages[current][key];
  const template = typeof entry === 'string' ? entry : params?.n === 1 ? entry.one : entry.other;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

function syncDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current === 'zh' ? 'zh-Hant' : 'en';
  document.title = t('appTitle');
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', t('appDescription'));
}
syncDocument();

export function getLang(): Lang {
  return current;
}

export function setLang(next: Lang) {
  if (next === current) return;
  current = next;
  writeStored(next);
  syncDocument();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 目前語言；語言改變時會讓元件重新渲染。 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** 在元件裡使用：訂閱語言變化，並回傳 t。 */
export function useT() {
  useLang();
  return t;
}
