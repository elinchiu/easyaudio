import { AudioTrack } from '../types/track';
import { getDirectAudioUrl } from './driveParser';

export const DEFAULT_FOLDER_ID = '1J-6Cqy_XamKDEoT2lGp49d-OtP1g9i2m';

export interface FolderFetchResult {
  folderName: string;
  tracks: AudioTrack[];
}

/**
 * Fetch all audio files from a Google Drive folder ID using Google Drive API
 */
export async function fetchFolderAudioTracks(
  folderId: string,
  accessToken?: string | null
): Promise<FolderFetchResult> {
  const cleanId = extractFolderId(folderId);
  let folderName = 'Google Drive 音檔資料夾';

  // 1. Fetch folder metadata if token available
  if (accessToken) {
    try {
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${cleanId}?fields=id,name`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta.name) folderName = meta.name;
      }
    } catch (e) {
      console.warn('Could not fetch folder metadata:', e);
    }
  }

  // 2. Query all files inside this folder
  const query = `'${cleanId}' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=nextPageToken,files(id,name,mimeType,size,webContentLink)&pageSize=1000&orderBy=name`;

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `無法讀取資料夾 (代碼 ${response.status})：${errorText.includes('PERMISSION_DENIED') || response.status === 401 ? '需要授權存取此資料夾' : errorText}`
    );
  }

  const data = await response.json();
  const rawFiles: any[] = data.files || [];

  // Identify any subfolders
  const subFolders = rawFiles.filter(
    (f) => f.mimeType === 'application/vnd.google-apps.folder'
  );

  let allAudioFiles = rawFiles.filter((f) => isAudioFile(f));

  // If there are subfolders, fetch tracks from each subfolder as well
  if (accessToken) {
    for (const sub of subFolders) {
      try {
        const subQuery = `'${sub.id}' in parents and trashed = false`;
        const subUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          subQuery
        )}&fields=files(id,name,mimeType,size,webContentLink)&pageSize=1000&orderBy=name`;
        const subRes = await fetch(subUrl, { headers });
        if (subRes.ok) {
          const subData = await subRes.json();
          const subAudio = (subData.files || []).filter((f: any) => isAudioFile(f));
          allAudioFiles = allAudioFiles.concat(subAudio);
        }
      } catch (err) {
        console.warn(`Error scanning subfolder ${sub.name}:`, err);
      }
    }
  }

  const tracks: AudioTrack[] = allAudioFiles.map((f) => ({
    id: f.id,
    name: f.name, // Keep exact full filename
    cleanName: f.name,
    size: f.size ? parseInt(f.size, 10) : undefined,
    mimeType: f.mimeType,
    audioUrl: getDirectAudioUrl(f.id),
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
 * Stream audio blob for Google Drive file if media request required
 */
export async function getTrackPlayableUrl(
  track: AudioTrack,
  accessToken?: string | null
): Promise<string> {
  if (track.audioUrl && !track.audioUrl.includes('drive.google.com')) {
    return track.audioUrl;
  }

  // If we have an accessToken, fetch media blob for guaranteed playback
  if (accessToken && !track.id.startsWith('demo-') && !track.id.startsWith('local-')) {
    try {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${track.id}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const blob = await res.blob();
        return URL.createObjectURL(blob);
      }
    } catch (e) {
      console.warn('Bearer media fetch failed, fallback to direct url:', e);
    }
  }

  return track.audioUrl || getDirectAudioUrl(track.id);
}
