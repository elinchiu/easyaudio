import { AudioTrack } from '../types/track';
import { getDirectAudioUrl } from './driveParser';
import { t } from './i18n';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_FOLDER_DEPTH = 5;

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

export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class DriveRequestError extends Error {
  /** 找不到 / 沒有權限這類錯誤，多半是私人檔案造成的，值得提醒使用者登入。 */
  suggestsLogin: boolean;

  constructor(message: string, suggestsLogin = false) {
    super(message);
    this.name = 'DriveRequestError';
    this.suggestsLogin = suggestsLogin;
  }
}

export interface MediaErrorExplanation {
  message: string;
  suggestsLogin: boolean;
}

export function extractFolderId(input: string): string {
  const text = input.trim();
  return (
    text.match(/\/folders\/([\w-]{20,})/)?.[1] ??
    text.match(/[?&]id=([\w-]{20,})/)?.[1] ??
    text
  );
}

function getPublicMediaUrl(fileId: string): string {
  return API_KEY
    ? `${DRIVE_API}/files/${fileId}?alt=media&key=${encodeURIComponent(API_KEY)}`
    : getDirectAudioUrl(fileId);
}

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

async function buildError(
  response: Response,
  hasToken: boolean,
  subjectKind: 'folder' | 'file' = 'folder'
): Promise<DriveRequestError> {
  const { status } = response;
  let reason = '';
  let message = '';

  try {
    const error = (await response.json())?.error;
    reason =
      error?.details?.find((d: any) => d?.reason)?.reason ||
      error?.errors?.[0]?.reason ||
      error?.status ||
      '';
    message = error?.message || '';
  } catch {}
  console.warn('[Drive API error]', status, reason, message);

  const subject = t(subjectKind === 'folder' ? 'subjectFolder' : 'subjectFile');
  const is = (...reasons: string[]) => reasons.includes(reason);
  const raw = t('googleResponse', { detail: [status, reason, message].filter(Boolean).join(' / ') });

  if (
    is('API_KEY_SERVICE_BLOCKED') ||
    (/are blocked/i.test(message) && /API/i.test(message) && !is('API_KEY_HTTP_REFERRER_BLOCKED'))
  ) {
    return new DriveRequestError(t('errApiKeyRestricted', { raw }));
  }
  if (is('API_KEY_HTTP_REFERRER_BLOCKED') || /referer/i.test(message)) {
    return new DriveRequestError(t('errReferrerBlocked'));
  }
  if (is('accessNotConfigured', 'SERVICE_DISABLED')) {
    return new DriveRequestError(t('errApiDisabled'));
  }
  if (is('keyInvalid', 'API_KEY_INVALID') || /API key not valid/i.test(message)) {
    return new DriveRequestError(t('errKeyInvalid'));
  }
  if (is('rateLimitExceeded', 'userRateLimitExceeded') || status === 429) {
    return new DriveRequestError(t('errRateLimit'));
  }
  if (is('downloadQuotaExceeded')) {
    return new DriveRequestError(t('errDownloadQuota', { subject, raw }));
  }
  if (status === 404 || is('notFound')) {
    return new DriveRequestError(
      hasToken ? t('errNotFoundSignedIn', { subject }) : t('errNotFoundPublic', { subject }),
      true
    );
  }
  if (status === 401 || status === 403) {
    return new DriveRequestError(
      hasToken ? t('errNoPermission', { subject, raw }) : t('errCannotRead', { subject, raw }),
      true
    );
  }
  return new DriveRequestError(
    t('errReadFailed', { subject, status, detail: message ? t('detailSep') + message : '' })
  );
}

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

function isAudioFile(file: DriveFile): boolean {
  return (
    file.mimeType?.startsWith('audio/') ||
    file.mimeType === 'video/mp4' ||
    /\.(mp3|wav|m4a|aac|ogg|flac|wma|opus|mp4a)$/i.test(file.name || '')
  );
}

export async function fetchFolderAudioTracks(
  folderId: string,
  accessToken?: string | null
): Promise<FolderFetchResult> {
  const rootId = extractFolderId(folderId);
  let folderName = 'File Name';

  if (!accessToken && !API_KEY) {
    throw new Error(t('errNoApiKey'));
  }

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

  if (metaStatus === 404) {
    if (!accessToken) {
      throw new AuthRequiredError(t('errFolderNotPublic'));
    }
    throw new Error(t('errFolderNotFoundSignedIn'));
  }

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
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  return { folderName, tracks };
}

export async function getTrackPlayableUrl(
  track: AudioTrack,
  accessToken?: string | null
): Promise<string> {
  if (accessToken) {
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

  return getPublicMediaUrl(track.id);
}

export async function explainMediaUrlError(url: string): Promise<MediaErrorExplanation | null> {
  const controller = new AbortController();
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.ok) {
      controller.abort();
      return null;
    }
    const error = await buildError(res, false, 'file');
    return { message: error.message, suggestsLogin: error.suggestsLogin };
  } catch {}

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
    if (probe.ok) return { message: t('mediaBlocked'), suggestsLogin: false };
    const error = await buildError(probe, false, 'file');
    return { message: error.message, suggestsLogin: error.suggestsLogin };
  } catch {
    return { message: t('errCannotReachDrive'), suggestsLogin: false };
  }
}