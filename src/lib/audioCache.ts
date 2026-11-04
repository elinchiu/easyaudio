import { AudioTrack } from '../types/track';

const DB_NAME = 'textbook_audio_db';
const DB_VERSION = 1;
const STORE_AUDIO = 'audio_blobs';
const STORE_TRACKS = 'tracks_metadata';
const STORE_USER_DATA = 'user_data';

// Open IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO);
      }
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_USER_DATA)) {
        db.createObjectStore(STORE_USER_DATA);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Cache audio Blob for offline playback
 */
export async function saveAudioBlob(trackId: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUDIO, 'readwrite');
      const store = tx.objectStore(STORE_AUDIO);
      const req = store.put(blob, trackId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to cache audio blob in IndexedDB:', err);
  }
}

/**
 * Retrieve cached audio Blob
 */
export async function getCachedAudioBlob(trackId: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUDIO, 'readonly');
      const store = tx.objectStore(STORE_AUDIO);
      const req = store.get(trackId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to get cached audio blob:', err);
    return null;
  }
}

/**
 * Remove audio blob from cache
 */
export async function removeCachedAudioBlob(trackId: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUDIO, 'readwrite');
      const store = tx.objectStore(STORE_AUDIO);
      const req = store.delete(trackId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to delete cached audio blob:', err);
  }
}

/**
 * Check if a track is cached offline
 */
export async function isTrackCachedOffline(trackId: string): Promise<boolean> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_AUDIO, 'readonly');
      const store = tx.objectStore(STORE_AUDIO);
      const req = store.getKey(trackId);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Save tracks list metadata
 */
export async function saveTracksMetadata(folderId: string, tracks: AudioTrack[]): Promise<void> {
  try {
    localStorage.setItem(`cached_tracks_${folderId}`, JSON.stringify(tracks));
    localStorage.setItem(`cached_tracks_time_${folderId}`, Date.now().toString());
  } catch (err) {
    console.warn('Failed to save tracks metadata to localStorage:', err);
  }
}

/**
 * Load tracks list metadata
 */
export function loadTracksMetadata(folderId: string): { tracks: AudioTrack[]; time: number } | null {
  try {
    const raw = localStorage.getItem(`cached_tracks_${folderId}`);
    const time = localStorage.getItem(`cached_tracks_time_${folderId}`);
    if (!raw) return null;
    return {
      tracks: JSON.parse(raw),
      time: time ? parseInt(time, 10) : 0,
    };
  } catch {
    return null;
  }
}

/**
 * User favorites & notes storage
 */
export function getStoredUserData(): {
  favorites: Record<string, boolean>;
  notes: Record<string, string>;
  bookmarkedPages: Record<string, string>;
} {
  try {
    const favorites = JSON.parse(localStorage.getItem('tb_favorites') || '{}');
    const notes = JSON.parse(localStorage.getItem('tb_notes') || '{}');
    const bookmarkedPages = JSON.parse(localStorage.getItem('tb_pages') || '{}');
    return { favorites, notes, bookmarkedPages };
  } catch {
    return { favorites: {}, notes: {}, bookmarkedPages: {} };
  }
}

export function saveStoredUserData(data: {
  favorites?: Record<string, boolean>;
  notes?: Record<string, string>;
  bookmarkedPages?: Record<string, string>;
}) {
  try {
    if (data.favorites) localStorage.setItem('tb_favorites', JSON.stringify(data.favorites));
    if (data.notes) localStorage.setItem('tb_notes', JSON.stringify(data.notes));
    if (data.bookmarkedPages) localStorage.setItem('tb_pages', JSON.stringify(data.bookmarkedPages));
  } catch (err) {
    console.warn('Failed to save user data:', err);
  }
}
