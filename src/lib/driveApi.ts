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
const API_KEY: string = (import.meta.env.VITE_GOOGLE_API_KEY || '').trim();

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

export interface FolderFetchResult {
  folderName: string;
  tracks: AudioTrack[];
}

/**
 * 資料夾不是公開的（用 API Key 讀不到），需要使用者登入 Google 才能讀取。
 * 呼叫端用 error.name === 'AuthRequiredError' 判斷，然後跳出登入視窗。
 */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

/** 從完整網址或純 ID 取出資料夾 ID */
export function extractFolderId(input: string): string {
  const text = input.trim();
  return (
    text.match(/\/folders\/([\w-]{20,})/)?.[1] ??
    text.match(/[?&]id=([\w-]{20,})/)?.[1] ??
    text
  );
}

/** 公開檔案的直接串流網址（走 Drive API + API Key，不需登入） */
function getPublicMediaUrl(fileId: string): string {
  return API_KEY
    ? `${DRIVE_API}/files/${fileId}?alt=media&key=${encodeURIComponent(API_KEY)}`
    : getDirectAudioUrl(fileId);
}

/**
 * 呼叫 Drive API：有 token 用 token，沒有就帶 API Key。
 * token 過期或被撤銷（401）時，如果有 API Key 就自動改用公開方式再試一次，
 * 所以公開資料夾不會因為過期的登入而讀取失敗。
 */
async function driveGet(
  path: string,
  params: Record<string, string>,
  accessToken?: string | null
): Promise<Response> {
  const withKey = () => {
    const search = new URLSearchParams(params);
    if (API_KEY) search.set('key', API_KEY);
    return fetch(`${DRIVE_API}${path}?${search}`);
  };

  if (!accessToken) return withKey();

  const res = await fetch(`${DRIVE_API}${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 && API_KEY) return withKey();
  return res;
}

/**
 * 把 Drive API 的錯誤回應轉成看得懂的中文訊息。
 * subject 是出錯的對象（讀取資料夾時是「資料夾」，播放時是「音檔」）。
 */
async function buildError(
  response: Response,
  hasToken: boolean,
  subject = '資料夾'
): Promise<Error> {
  const { status } = response;
  let reason = '';
  let message = '';

  try {
    const error = (await response.json())?.error;
    // details[].reason 比 errors[0].reason 更精確（例如 API_KEY_SERVICE_BLOCKED）
    reason =
      error?.details?.find((d: any) => d?.reason)?.reason ||
      error?.errors?.[0]?.reason ||
      error?.status ||
      '';
    message = error?.message || '';
  } catch {
    // 回應不是 JSON，略過
  }
  console.warn('[Drive API error]', status, reason, message);

  const is = (...reasons: string[]) => reasons.includes(reason);
  const raw = `（Google 回應：${[status, reason, message].filter(Boolean).join(' / ')}）`;

  if (
    is('API_KEY_SERVICE_BLOCKED') ||
    (/are blocked/i.test(message) && /API/i.test(message) && !is('API_KEY_HTTP_REFERRER_BLOCKED'))
  ) {
    return new Error(`API Key 的「API 限制」沒有包含 Google Drive API，請到 Cloud Console 勾選。${raw}`);
  }
  if (is('API_KEY_HTTP_REFERRER_BLOCKED') || /referer/i.test(message)) {
    return new Error('API Key 的網站來源（HTTP referrer）限制沒有包含目前的網域，請到 Google Cloud Console 加入。');
  }
  if (is('accessNotConfigured', 'SERVICE_DISABLED')) {
    return new Error('Google Cloud 專案尚未啟用 Google Drive API，請先啟用。');
  }
  if (is('keyInvalid', 'API_KEY_INVALID') || /API key not valid/i.test(message)) {
    return new Error('API Key 無效，請檢查 VITE_GOOGLE_API_KEY 是否正確。');
  }
  if (is('rateLimitExceeded', 'userRateLimitExceeded') || status === 429) {
    return new Error('Google Drive 請求過於頻繁，請稍後再試。');
  }
  if (is('downloadQuotaExceeded')) {
    return new Error(`這個${subject}的下載流量已達 Google 的上限，請稍後再試。${raw}`);
  }
  if (status === 404 || is('notFound')) {
    return new Error(
      hasToken
        ? `找不到此${subject}，請確認網址是否正確。`
        : `找不到此${subject}。請確認網址正確，且${subject}分享設定為「知道連結的任何人 → 檢視者」。`
    );
  }
  if (status === 401 || status === 403) {
    return new Error(
      hasToken
        ? `沒有權限存取此${subject}。${raw}`
        : `無法讀取此${subject}。請確認${subject}分享設定為「知道連結的任何人 → 檢視者」。${raw}`
    );
  }
  return new Error(`無法讀取${subject} (代碼 ${status})${message ? `：${message}` : ''}`);
}

/** 列出單一資料夾內所有項目（自動翻頁） */
async function listFolderFiles(folderId: string, accessToken?: string | null): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
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

/** 是否為音檔 */
function isAudioFile(file: DriveFile): boolean {
  return (
    file.mimeType?.startsWith('audio/') ||
    file.mimeType === 'video/mp4' ||
    /\.(mp3|wav|m4a|aac|ogg|flac|wma|opus|mp4a)$/i.test(file.name || '')
  );
}

/**
 * 讀取資料夾（含子資料夾）內所有音檔。
 * 公開資料夾：不需要 accessToken，只要有 API Key 即可。
 * 私人資料夾且沒有登入：丟出 AuthRequiredError，讓畫面請使用者登入 Google。
 */
export async function fetchFolderAudioTracks(
  folderId: string,
  accessToken?: string | null
): Promise<FolderFetchResult> {
  const rootId = extractFolderId(folderId);
  let folderName = 'File Name';

  if (!accessToken && !API_KEY) {
    throw new Error('尚未設定 API Key（VITE_GOOGLE_API_KEY），無法讀取公開資料夾。');
  }

  // 1. 資料夾名稱，同時確認這個資料夾能不能被讀取
  let metaStatus = 0;
  try {
    const res = await driveGet(
      `/files/${rootId}`,
      { fields: 'id,name', supportsAllDrives: 'true' },
      accessToken
    );
    metaStatus = res.status;
    if (res.ok) folderName = (await res.json()).name || folderName;
  } catch (e) {
    console.warn('Could not fetch folder metadata:', e);
  }

  // 公開資料夾用 API Key 一定讀得到。回 404 代表它不是公開的（或網址有誤）。
  // 注意：私人資料夾列出內容時不會報錯，只會回傳空清單，所以一定要在這裡先擋下來，
  // 否則畫面會顯示「成功匯入 0 首」，使用者完全不知道原因。
  if (metaStatus === 404) {
    if (!accessToken) {
      throw new AuthRequiredError('這個資料夾不是公開的。');
    }
    throw new Error('找不到此資料夾，請確認網址是否正確，以及目前登入的 Google 帳號有權限存取。');
  }

  // 2. 掃描資料夾與所有子資料夾（BFS，限制深度，避免循環）
  const audioFiles: DriveFile[] = [];
  const visited = new Set([rootId]);
  let queue = [rootId];

  for (let depth = 0; depth <= MAX_FOLDER_DEPTH && queue.length > 0; depth++) {
    const nextQueue: string[] = [];

    for (const currentId of queue) {
      let items: DriveFile[];
      try {
        items = await listFolderFiles(currentId, accessToken);
      } catch (err) {
        // 根資料夾失敗就直接丟出錯誤；子資料夾失敗則略過
        if (currentId === rootId) throw err;
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
          audioFiles.push(f);
        }
      }
    }

    queue = nextQueue;
  }

  const tracks: AudioTrack[] = audioFiles
    .map((f) => ({
      id: f.id,
      name: f.name,
      cleanName: f.name,
      size: f.size ? Number(f.size) : undefined,
      mimeType: f.mimeType,
      audioUrl: getPublicMediaUrl(f.id),
    }))
    // 依檔名自然排序（2 排在 10 前面）
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  return { folderName, tracks };
}

/**
 * 取得可播放的網址。
 * - 已登入：用 Bearer token 下載成 blob（可播放私人檔案）；token 過期或失敗就改用公開網址
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
      if (res.ok) return URL.createObjectURL(await res.blob());
    } catch (e) {
      console.warn('Bearer media fetch failed, fallback to public url:', e);
    }
  }

  if (track.audioUrl && !track.audioUrl.includes('drive.google.com')) {
    return track.audioUrl;
  }

  return isRemoteDriveFile
    ? getPublicMediaUrl(track.id)
    : track.audioUrl || getDirectAudioUrl(track.id);
}

/** Google 拒絕下載、但又讀不到錯誤內容時（瀏覽器只看到 CORS 錯誤）的說明 */
const MEDIA_BLOCKED_MESSAGE =
  'Google 暫時拒絕了這個音檔的下載（常見原因：Google 偵測到大量自動化請求，或這個檔案的下載流量已達上限）。請稍等一段時間，或換個網路（例如關閉 VPN、改用行動網路）後再試。';

/**
 * 音檔網址播放失敗時，向 Google 查出真正的原因（<audio> 元素本身看不到錯誤內容）。
 * 回傳看得懂的中文訊息；如果網址本身其實能正常讀取（例如是音檔格式問題），回傳 null。
 *
 * 注意：Google 擋下請求時（例如「We're sorry… automated queries」頁面）回應不帶 CORS 標頭，
 * fetch 會直接丟錯、讀不到狀態碼。這時改用「只查檔案資訊」的請求當探針（它有 CORS）：
 * 探針成功代表網路、API Key、檔案權限都沒問題，是下載本身被 Google 擋下；探針也失敗就照實回報。
 */
export async function explainMediaUrlError(url: string): Promise<string | null> {
  const controller = new AbortController();
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.ok) {
      controller.abort(); // 網址可以讀，不需要真的把整個音檔下載下來
      return null;
    }
    return (await buildError(res, false, '音檔')).message;
  } catch {
    // 讀不到回應內容（CORS 被擋或連線失敗），往下用探針確認
  }

  let probeUrl: string;
  try {
    const u = new URL(url);
    u.searchParams.delete('alt');
    u.searchParams.set('fields', 'id,name');
    u.searchParams.set('supportsAllDrives', 'true');
    probeUrl = u.toString();
  } catch {
    return null;
  }

  try {
    const probe = await fetch(probeUrl);
    if (probe.ok) return MEDIA_BLOCKED_MESSAGE;
    return (await buildError(probe, false, '音檔')).message;
  } catch {
    return '無法連線到 Google Drive，請確認網路連線後再試。';
  }
}