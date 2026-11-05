import { AudioTrack } from '../types/track';

/**
 * 從各種 Google Drive 連結格式取出檔案 ID：
 * - https://drive.google.com/file/d/FILE_ID/view...
 * - https://drive.google.com/open?id=FILE_ID
 * - https://drive.google.com/uc?id=FILE_ID...
 * - 或直接貼 FILE_ID
 */
export function extractDriveFileId(url: string): string | null {
  const text = url.trim();
  return (
    text.match(/\/file\/d\/([\w-]{20,})/)?.[1] ??
    text.match(/[?&]id=([\w-]{20,})/)?.[1] ??
    (/^[\w-]{25,}$/.test(text) ? text : null)
  );
}

/** 檔案 ID 轉成可直接串流的音檔網址 */
export function getDirectAudioUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/**
 * 解析一行一個的 Drive 連結，可附自訂檔名，例如 "Lesson 1.mp3 - https://..."
 */
export function parseImportedLinks(text: string): AudioTrack[] {
  return text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .flatMap((line): AudioTrack[] => {
      const id = extractDriveFileId(line);
      if (!id) return [];

      // 把連結本身拿掉，剩下的文字當作檔名
      const link = line.split(/\s+/).find((t) => extractDriveFileId(t) === id) ?? '';
      const name =
        line.replace(link, '').replace(/^[\s,-]+|[\s,-]+$/g, '') ||
        `Google_Drive_Audio_${id.slice(0, 8)}.mp3`;

      return [{ id, name, cleanName: name, audioUrl: getDirectAudioUrl(id) }];
    });
}