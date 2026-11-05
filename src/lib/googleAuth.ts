/**
 * 以 Google Identity Services (GIS) 取得 Drive 唯讀 access token。
 * 介面刻意與原本 firebase.ts 的 googleSignIn / initAuth 相同，
 * App.tsx 只要把 import 路徑換掉即可。
 *
 * Client ID 是公開資訊（會出現在網頁原始碼裡），不是機密，可以直接放在前端。
 */

const CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ||
  '720735205339-1r7oqfega6hptavufoi2sqe64e35emoo.apps.googleusercontent.com';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

type AuthListener = (user: null, token: string | null) => void;

let accessToken: string | null = null;
let expiryTimer: number | undefined;
const listeners = new Set<AuthListener>();

const emit = () => listeners.forEach((fn) => fn(null, accessToken));

const gis = () => (window as any).google?.accounts?.oauth2;

// ---------- 載入 GIS 腳本 ----------
let gisReady: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (gisReady) return gisReady;
  gisReady = new Promise<void>((resolve, reject) => {
    if (gis()) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisReady = null;
      reject(new Error('無法載入 Google 登入元件，請檢查網路連線。'));
    };
    document.head.appendChild(s);
  });
  return gisReady;
}

// 一開頁就先載入，這樣使用者按登入時腳本已就緒，彈出視窗不會被瀏覽器擋掉
loadGis().catch(() => {});

// ---------- 登入 ----------
export function googleSignIn(): Promise<{ accessToken: string } | null> {
  const start = () =>
    new Promise<{ accessToken: string } | null>((resolve, reject) => {
      const client = gis().initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        prompt: 'select_account',
        callback: (resp: any) => {
          if (resp.error) {
            reject(new Error(resp.error_description || resp.error));
            return;
          }
          accessToken = resp.access_token;

          // token 約一小時過期：到期前 1 分鐘視為登出
          window.clearTimeout(expiryTimer);
          const ms = Math.max(((resp.expires_in ?? 3600) - 60) * 1000, 0);
          expiryTimer = window.setTimeout(() => {
            accessToken = null;
            emit();
          }, ms);

          emit();
          resolve({ accessToken: accessToken! });
        },
        // 使用者關閉視窗、彈出視窗被擋等
        error_callback: (err: any) =>
          reject(new Error(err?.type || 'popup_failed_to_open')),
      });
      client.requestAccessToken();
    });

  // 腳本已載入就同步呼叫，保留「使用者點擊」的授權狀態
  if (gis()) return start();
  return loadGis().then(start);
}

// ---------- 登出 ----------
export function googleSignOut(): void {
  const token = accessToken;
  accessToken = null;
  window.clearTimeout(expiryTimer);
  if (token && gis()) gis().revoke(token, () => {});
  emit();
}

// ---------- 訂閱登入狀態（回傳取消訂閱函式，與原本 initAuth 用法相同） ----------
export function initAuth(cb: AuthListener): () => void {
  listeners.add(cb);
  cb(null, accessToken);
  return () => {
    listeners.delete(cb);
  };
}
