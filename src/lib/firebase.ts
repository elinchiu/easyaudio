import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Google 登入，並要求 Drive 唯讀權限（讀取私人資料夾用）。
// 不強制跳出帳號選擇畫面：之前登入過的帳號會自動帶入，過期後重新登入時視窗一閃就好。
export const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.readonly');

// 登入進行中的旗標
let isSigningIn = false;

// ───────────────────────── Access token ─────────────────────────
// Firebase 會記住「使用者是誰」，但不會保存 Google Drive 用的 access token，
// 所以重新整理網頁後 token 會消失。這裡把 token 連同過期時間存在 localStorage：
// - 重新整理時，token 還沒過期就直接沿用，不用重新登入
// - Google 的 token 約 1 小時過期，過期後會自動丟棄（公開資料夾改用 API Key，不受影響）
// 注意：token 只有 Drive「唯讀」權限，而且很快就過期；這是為了「重新整理不用重登」所做的取捨。
const TOKEN_STORAGE_KEY = 'ea_drive_token';

// Google 的 token 有效 3600 秒；提早 5 分鐘視為過期，避免剛好在使用時失效
const TOKEN_LIFETIME_MS = 55 * 60 * 1000;

let cachedAccessToken: string | null = null;
let cachedExpiresAt = 0;

/** 儲存（或清除）token，同時更新記憶體與 localStorage */
function storeToken(token: string | null) {
  cachedAccessToken = token;
  cachedExpiresAt = token ? Date.now() + TOKEN_LIFETIME_MS : 0;
  try {
    if (token) {
      localStorage.setItem(
        TOKEN_STORAGE_KEY,
        JSON.stringify({ token, expiresAt: cachedExpiresAt })
      );
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage 不可用（例如無痕模式）：只存在記憶體，重新整理後需重新登入
  }
}

/** 啟動時從 localStorage 還原還沒過期的 token */
function restoreStoredToken() {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return;
    const { token, expiresAt } = JSON.parse(raw);
    if (typeof token === 'string' && typeof expiresAt === 'number' && expiresAt > Date.now()) {
      cachedAccessToken = token;
      cachedExpiresAt = expiresAt;
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}
restoreStoredToken();

/** 目前有效的 token；過期了就清掉並回傳 null */
function getValidToken(): string | null {
  if (cachedAccessToken && Date.now() >= cachedExpiresAt) storeToken(null);
  return cachedAccessToken;
}

/** 啟動時監聽登入狀態 */
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) =>
  onAuthStateChanged(auth, (user) => {
    if (!user) storeToken(null);

    const token = user ? getValidToken() : null;
    if (user && token) {
      onAuthSuccess?.(user, token);
    } else if (!user || !isSigningIn) {
      // 未登入，或已登入 Firebase 但沒有（或已過期的）Drive 用 token
      onAuthFailure?.();
    }
  });

/** 跳出 Google 登入視窗，並取得 Drive API 的 access token */
export const googleSignIn = async (): Promise<{ user: User; accessToken: string }> => {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token) throw new Error('無法取得 Google 雲端授權存取 Token');

    storeToken(token);
    return { user: result.user, accessToken: token };
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async () => getValidToken();

/** 目前 token 的過期時間（毫秒時間戳）；沒有 token 時是 0 */
export const getAccessTokenExpiresAt = () => cachedExpiresAt;

export const setCachedAccessToken = (token: string | null) => {
  storeToken(token);
};

/** 登出並清除 token */
export const logout = async () => {
  await signOut(auth);
  storeToken(null);
};