import { AudioTrack } from '../types/track';

const DB_NAME = 'textbook_audio_db';
const DB_VERSION = 1;
const STORE_AUDIO = 'audio_blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

/** 開啟 IndexedDB（只開一次，之後重複使用同一個連線） */
function openDB(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_AUDIO)) db.createObjectStore(STORE_AUDIO);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null; // 失敗時允許下次重試
      reject(request.error);
    };
  });
  return dbPromise;
}

/** 對音檔 store 執行一個 IndexedDB 請求，並回傳結果 */
async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = action(db.transaction(STORE_AUDIO, mode).objectStore(STORE_AUDIO));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 把音檔 Blob 存進快取（離線播放用） */
export async function saveAudioBlob(trackId: string, blob: Blob): Promise<void> {
  try {
    await run('readwrite', (store) => store.put(blob, trackId));
  } catch (err) {
    console.warn('Failed to cache audio blob in IndexedDB:', err);
  }
}

/** 讀取快取的音檔 Blob，沒有就回傳 null */
export async function getCachedAudioBlob(trackId: string): Promise<Blob | null> {
  try {
    return (await run<Blob | undefined>('readonly', (store) => store.get(trackId))) || null;
  } catch (err) {
    console.warn('Failed to get cached audio blob:', err);
    return null;
  }
}

/** 刪除快取的音檔 */
export async function removeCachedAudioBlob(trackId: string): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(trackId));
  } catch (err) {
    console.warn('Failed to delete cached audio blob:', err);
  }
}

/** 這首是否已快取可離線播放 */
export async function isTrackCachedOffline(trackId: string): Promise<boolean> {
  try {
    return !!(await run('readonly', (store) => store.getKey(trackId)));
  } catch {
    return false;
  }
}

/** 儲存音檔清單（依資料夾 ID） */
export async function saveTracksMetadata(folderId: string, tracks: AudioTrack[]): Promise<void> {
  try {
    localStorage.setItem(`cached_tracks_${folderId}`, JSON.stringify(tracks));
    localStorage.setItem(`cached_tracks_time_${folderId}`, Date.now().toString());
  } catch (err) {
    console.warn('Failed to save tracks metadata to localStorage:', err);
  }
}

/** 讀取音檔清單與存入時間 */
export function loadTracksMetadata(folderId: string): { tracks: AudioTrack[]; time: number } | null {
  try {
    const raw = localStorage.getItem(`cached_tracks_${folderId}`);
    if (!raw) return null;
    const time = localStorage.getItem(`cached_tracks_time_${folderId}`);
    return { tracks: JSON.parse(raw), time: time ? parseInt(time, 10) : 0 };
  } catch {
    return null;
  }
}

/** 使用者資料：收藏、筆記、書籤頁碼 */
interface UserData {
  favorites: Record<string, boolean>;
  notes: Record<string, string>;
  bookmarkedPages: Record<string, string>;
}

const USER_DATA_KEYS: Record<keyof UserData, string> = {
  favorites: 'tb_favorites',
  notes: 'tb_notes',
  bookmarkedPages: 'tb_pages',
};

export function getStoredUserData(): UserData {
  const read = (key: string) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return {};
    }
  };
  return {
    favorites: read(USER_DATA_KEYS.favorites),
    notes: read(USER_DATA_KEYS.notes),
    bookmarkedPages: read(USER_DATA_KEYS.bookmarkedPages),
  };
}

export function saveStoredUserData(data: Partial<UserData>) {
  try {
    for (const field of Object.keys(USER_DATA_KEYS) as (keyof UserData)[]) {
      const value = data[field];
      if (value) localStorage.setItem(USER_DATA_KEYS[field], JSON.stringify(value));
    }
  } catch (err) {
    console.warn('Failed to save user data:', err);
  }
}