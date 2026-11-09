import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.readonly');

const TOKEN_STORAGE_KEY = 'ea_drive_token';

const TOKEN_LIFETIME_MS = 55 * 60 * 1000;

let cachedAccessToken: string | null = null;
let cachedExpiresAt = 0;

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
  } catch {}
}

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
  } catch {}
}
restoreStoredToken();

function getValidToken(): string | null {
  if (cachedAccessToken && Date.now() >= cachedExpiresAt) storeToken(null);
  return cachedAccessToken;
}

export const initAuth = (onAuthSuccess: (user: User, token: string) => void) =>
  onAuthStateChanged(auth, (user) => {
    if (!user) storeToken(null);

    const token = user ? getValidToken() : null;
    if (user && token) onAuthSuccess(user, token);
  });

export const googleSignIn = async (): Promise<{ user: User; accessToken: string }> => {
  const result = await signInWithPopup(auth, provider);
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error('無法取得 Google 雲端授權存取 Token');

  storeToken(token);
  return { user: result.user, accessToken: token };
};

export const getAccessTokenExpiresAt = () => cachedExpiresAt;