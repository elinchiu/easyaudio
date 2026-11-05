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

// Google 登入，並要求 Drive 唯讀權限（讀取私人資料夾用）
export const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
provider.setCustomParameters({ prompt: 'select_account' });

// 登入進行中的旗標
let isSigningIn = false;

// Access token 只存在記憶體，不寫入 localStorage（較安全，重新整理後需重新登入）
let cachedAccessToken: string | null = null;

/** 啟動時監聽登入狀態 */
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) =>
  onAuthStateChanged(auth, (user) => {
    if (!user) cachedAccessToken = null;

    if (user && cachedAccessToken) {
      onAuthSuccess?.(user, cachedAccessToken);
    } else if (!user || !isSigningIn) {
      // 未登入，或已登入 Firebase 但沒有 Drive 用的 token
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

    cachedAccessToken = token;
    return { user: result.user, accessToken: token };
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async () => cachedAccessToken;

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

/** 登出並清除 token */
export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};