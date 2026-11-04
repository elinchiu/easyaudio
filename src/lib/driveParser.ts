import { AudioTrack } from '../types/track';

/**
 * Extracts Google Drive file ID from various URL formats:
 * - https://drive.google.com/file/d/FILE_ID/view...
 * - https://drive.google.com/open?id=FILE_ID
 * - https://drive.google.com/uc?id=FILE_ID...
 */
export function extractDriveFileId(url: string): string | null {
  const matchD = url.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
  if (matchD && matchD[1]) return matchD[1];

  const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (matchId && matchId[1]) return matchId[1];

  // Raw file ID
  if (/^[a-zA-Z0-9_-]{25,}$/.test(url.trim())) {
    return url.trim();
  }

  return null;
}

/**
 * Converts Google Drive file ID to direct public streamable audio URL
 */
export function getDirectAudioUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/**
 * Parses user input containing one or multiple Google Drive links or text
 */
export function parseImportedLinks(text: string): AudioTrack[] {
  const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const results: AudioTrack[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fileId = extractDriveFileId(line);

    if (fileId) {
      // Check if line also has a custom title, e.g. "Lesson 1.mp3 - https://..."
      let customName = '';
      const parts = line.split(/\s*-\s*|\s*,\s*|\t+/);
      for (const p of parts) {
        if (!p.includes('drive.google.com') && !extractDriveFileId(p) && p.length > 2) {
          customName = p.trim();
          break;
        }
      }

      const fileName = customName || `Google_Drive_Audio_${fileId.slice(0, 8)}.mp3`;
      results.push({
        id: fileId,
        name: fileName,
        cleanName: fileName,
        audioUrl: getDirectAudioUrl(fileId),
      });
    }
  }

  return results;
}
