import { AudioTrack } from '../types/track';
import { getDirectAudioUrl } from './driveParser';

export const DEFAULT_FOLDER_ID = '1J-6Cqy_XamKDEoT2lGp49d-OtP1g9i2m';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_FOLDER_DEPTH = 5;

/**
 * 公開資料夾不需要使用者登入，但 Drive API 仍然需要一把 API Key。
 * 在 .env 設定 VITE_GOOGLE_API_KEY，部署時也要由 GitHub Secrets 注入。
 */
const API_KEY: string = ((import.meta as any).env?.VITE_GOOGLE_API_KEY || '').trim();

export interface FolderFetchResult {
  folderName: string;
  tracks: AudioTrack[];
}

/** 公開檔案的直接串流網址（走 Drive API + API Key，不需登入） */
function getPublicMediaUrl(fileId: string): string {
  if (API_KEY) {
    return `${DRIVE_API}/files/${fileId}?alt=media&key=${encodeURIComponent(API_KEY)}`;
  }
  return getDirectAudioUrl(fileId);
}

/** 呼叫 Drive API：有 token 用 token，沒有就帶 API Key */
async function driveGet(
  path: string,
  params: Record<string, string>,
  accessToken?: string | null
): Promise<Response> {
  const search = new URLSearchParams(params);
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  } else if (API_KEY) {
    search.set('key', API_KEY);
  }
  return fetch(`${DRIVE_API}${path}?${search.toString()}`, { headers });
}

async function buildError(response: Response, hasToken: boolean): Promise<Error> {
  let reason = '';
  let message = '';
  try {
    const body = await response.json();
    // details[].reason 比 errors[0].reason 更精確（例如 API_KEY_SERVICE_BLOCKED）
    const detailReason = (body?.error?.details || []).find((d: any) => d?.reason)?.reason;
    reason = detailReason || body?.error?.errors?.[0]?.reason || body?.error?.status || '';
    message = body?.error?.message || '';
  } catch {
    // ignore
  }
  console.warn('[Drive API error]', response.status, reason, message);
  const raw = `（Google 回應：${response.status}${reason ? ` / ${reason}` : ''}${message ? ` / ${message}` : ''}）`;

  if (reason === 'API_KEY_SERVICE_BLOCKED' || /are blocked/i.test(message) && /API/i.test(message) && reason !== 'API_KEY_HTTP_REFERRER_BLOCKED') {
    return new Error(`API Key 的「API 限制」沒有包含 Google Drive API，請到 Cloud Console 勾選。${raw}`);
  }

  if (reason === 'API_KEY_HTTP_REFERRER_BLOCKED' || /referer/i.test(message)) {
    return new Error('API Key 的網站來源（HTTP referrer）限制沒有包含目前的網域，請到 Google Cloud Console 加入。');
  }
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') {
    return new Error('Google Cloud 專案尚未啟用 Google Drive API，請先啟用。');
  }
  if (reason === 'keyInvalid' || reason === 'API_KEY_INVALID' || /API key not valid/i.test(message)) {
    return new Error('API Key 無效，請檢查 VITE_GOOGLE_API_KEY 是否正確。');
  }
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || response.status === 429) {
    return new Error('Google Drive 請求過於頻繁，請稍後再試。');
  }
  if (response.status === 404 || reason === 'notFound') {
    return new Error(
      hasToken
        ? '找不到此資料夾，請確認網址是否正確。'
        : '找不到此資料夾。請確認網址正確，且資料夾分享設定為「知道連結的任何人 → 檢視者」。'
    );
  }
  if (response.status === 401 || response.status === 403) {
    return new Error(
      hasToken
        ? '沒有權限存取此資料夾。'
        : '無法讀取此資料夾。請確認資料夾分享設定為「知道連結的任何人 → 檢視者」。'
    );
  }
  return new Error(`無法讀取資料夾 (代碼 ${response.status})${message ? `：${message}` : ''}`);
}

/** 列出單一資料夾內所有項目（自動翻頁） */
async function listFolderFiles(folderId: string, accessToken?: string | null): Promise<any[]> {
  const files: any[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = {
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,size)',
      pageSize: '1000',
      orderBy: 'name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    };
    if (pageToken) params.pageToken = pageToken;

    const res = await driveGet('/files', params, accessToken);
    if (!res.ok) throw await buildError(res, !!accessToken);

    const data = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

/**
 * Fetch all audio files from a Google Drive folder ID using Google Drive API.
 * 公開資料夾：不需要 accessToken，只要有 API Key 即可。
 */
export async function fetchFolderAudioTracks(
  folderId: string,
  accessToken?: string | null
): Promise<FolderFetchResult> {
  const cleanId = extractFolderId(folderId);
  let folderName = 'Google Drive 音檔資料夾';

  if (!accessToken && !API_KEY) {
    throw new Error('尚未設定 API Key（VITE_GOOGLE_API_KEY），無法讀取公開資料夾。');
  }

  // 1. Folder metadata（失敗不影響後續）
  try {
    const metaRes = await driveGet(
      `/files/${cleanId}`,
      { fields: 'id,name', supportsAllDrives: 'true' },
      accessToken
    );
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (meta.name) folderName = meta.name;
    }
  } catch (e) {
    console.warn('Could not fetch folder metadata:', e);
  }

  // 2. 掃描資料夾與所有子資料夾（BFS，限制深度，避免循環）
  const allAudioFiles: any[] = [];
  const visited = new Set<string>([cleanId]);
  let queue: string[] = [cleanId];

  for (let depth = 0; depth <= MAX_FOLDER_DEPTH && queue.length > 0; depth++) {
    const nextQueue: string[] = [];

    for (const currentId of queue) {
      let items: any[];
      try {
        items = await listFolderFiles(currentId, accessToken);
      } catch (err) {
        // 根資料夾失敗就直接丟出錯誤；子資料夾失敗則略過
        if (currentId === cleanId) throw err;
        console.warn(`Error scanning subfolder ${currentId}:`, err);
        continue;
      }

      for (const f of items) {
        if (f.mimeType === FOLDER_MIME) {
          if (!visited.has(f.id)) {
            visited.add(f.id);
            nextQueue.push(f.id);
          }
        } else if (isAudioFile(f)) {
          allAudioFiles.push(f);
        }
      }
    }

    queue = nextQueue;
  }

  const tracks: AudioTrack[] = allAudioFiles.map((f) => ({
    id: f.id,
    name: f.name, // Keep exact full filename
    cleanName: f.name,
    size: f.size ? parseInt(f.size, 10) : undefined,
    mimeType: f.mimeType,
    audioUrl: getPublicMediaUrl(f.id),
  }));

  // Natural sorting by filename
  tracks.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  return {
    folderName,
    tracks,
  };
}

/**
 * Extract clean Google Drive folder ID from full URL or ID string
 */
export function extractFolderId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{20,})/);
  if (match && match[1]) return match[1];

  const matchId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (matchId && matchId[1]) return matchId[1];

  return trimmed;
}

/**
 * Check if a file is an audio track
 */
function isAudioFile(file: { name?: string; mimeType?: string }): boolean {
  if (!file) return false;
  if (file.mimeType && (file.mimeType.startsWith('audio/') || file.mimeType === 'video/mp4')) return true;
  const audioExtensions = /\.(mp3|wav|m4a|aac|ogg|flac|wma|opus|mp4a)$/i;
  return !!(file.name && audioExtensions.test(file.name));
}

/**
 * 取得可播放的網址。
 * - 已登入：用 Bearer token 下載成 blob（可播放私人檔案）
 * - 未登入：直接使用 Drive API + API Key 的串流網址（公開檔案）
 */
export async function getTrackPlayableUrl(
  track: AudioTrack,
  accessToken?: string | null
): Promise<string> {
  const isRemoteDriveFile = !track.id.startsWith('demo-') && !track.id.startsWith('local-');

  if (accessToken && isRemoteDriveFile) {
    try {
      const res = await fetch(`${DRIVE_API}/files/${track.id}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const blob = await res.blob();
        return URL.createObjectURL(blob);
      }
    } catch (e) {
      console.warn('Bearer media fetch failed, fallback to public url:', e);
    }
  }

  if (track.audioUrl && !track.audioUrl.includes('drive.google.com')) {
    return track.audioUrl;
  }

  return isRemoteDriveFile ? getPublicMediaUrl(track.id) : track.audioUrl || getDirectAudioUrl(track.id);
}
