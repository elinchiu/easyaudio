import { LyricSegment } from '../types/track';

const LYRICS_CACHE_PREFIX = 'tb_lyrics_';

/**
 * Retrieve cached lyrics for a track from localStorage
 */
export function getStoredLyrics(trackId: string): LyricSegment[] | null {
  if (!trackId) return null;
  try {
    const raw = localStorage.getItem(`${LYRICS_CACHE_PREFIX}${trackId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to parse cached lyrics for track:', trackId, e);
  }
  return null;
}

/**
 * Save lyrics for a track into localStorage
 */
export function saveStoredLyrics(trackId: string, segments: LyricSegment[]): void {
  if (!trackId) return;
  try {
    localStorage.setItem(`${LYRICS_CACHE_PREFIX}${trackId}`, JSON.stringify(segments));
  } catch (e) {
    console.warn('Failed to save lyrics to cache:', e);
  }
}

/**
 * Remove cached lyrics
 */
export function clearStoredLyrics(trackId: string): void {
  if (!trackId) return;
  try {
    localStorage.removeItem(`${LYRICS_CACHE_PREFIX}${trackId}`);
  } catch (e) {
    console.warn('Failed to clear lyrics from cache:', e);
  }
}

/**
 * Parse standard LRC format string into LyricSegment[]
 * Supports format: [mm:ss.xx] or [mm:ss] or plain text lines
 */
export function parseLrc(content: string, estimatedDuration = 180): LyricSegment[] {
  const lines = content.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const segments: LyricSegment[] = [];

  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  let hasTimestamps = false;

  for (const line of lines) {
    // Skip metadata lines like [ti:...], [ar:...]
    if (/^\[(ti|ar|al|by|offset|length):/i.test(line)) {
      continue;
    }

    const matches = [...line.matchAll(timeRegex)];
    if (matches.length > 0) {
      hasTimestamps = true;
      const text = line.replace(timeRegex, '').trim();
      if (!text) continue;

      for (const match of matches) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const msStr = match[3] || '0';
        const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
        const startTime = min * 60 + sec + ms / 1000;

        segments.push({
          startTime,
          endTime: startTime + 4, // placeholder until sorted and adjusted
          text,
        });
      }
    }
  }

  // If no LRC timestamps found, treat as plain text and space evenly
  if (!hasTimestamps && lines.length > 0) {
    const step = Math.max(3, estimatedDuration / (lines.length + 1));
    return lines.map((text, idx) => ({
      startTime: Math.round(idx * step * 10) / 10,
      endTime: Math.round((idx + 1) * step * 10) / 10,
      text,
    }));
  }

  // Sort by startTime
  segments.sort((a, b) => a.startTime - b.startTime);

  // Adjust endTimes to match next line's start
  for (let i = 0; i < segments.length; i++) {
    if (i < segments.length - 1) {
      segments[i].endTime = Math.max(segments[i].startTime + 1, segments[i + 1].startTime);
    } else {
      segments[i].endTime = segments[i].startTime + 5;
    }
  }

  return segments;
}

/**
 * Export segments to standard .LRC format text
 */
export function exportLrc(segments: LyricSegment[], title?: string): string {
  const header = [
    `[ti:${title || 'Audio'}]`,
    `[by:Easy Audio Whisper]`,
    '',
  ];

  const body = segments.map((seg) => {
    const m = Math.floor(seg.startTime / 60).toString().padStart(2, '0');
    const s = Math.floor(seg.startTime % 60).toString().padStart(2, '0');
    const cs = Math.floor((seg.startTime % 1) * 100).toString().padStart(2, '0');
    return `[${m}:${s}.${cs}]${seg.text}${seg.translation ? ` (${seg.translation})` : ''}`;
  });

  return [...header, ...body].join('\n');
}

/**
 * Call the server-side Gemini audio transcription endpoint to generate timestamped lyrics
 */
export async function transcribeAudioWithAi(
  audioBlob: Blob,
  trackName: string,
  mimeType = 'audio/mp3'
): Promise<LyricSegment[]> {
  // Convert blob to base64
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const base64 = res.includes(',') ? res.split(',')[1] : res;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(audioBlob);
  });

  // Try endpoint, supporting both /api/transcribe and /easyaudio/api/transcribe
  const endpoints = ['/api/transcribe', '/easyaudio/api/transcribe'];
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioBase64: base64Data,
          mimeType: audioBlob.type || mimeType || 'audio/mp3',
          trackName,
        }),
      });

      if (!response.ok) {
        let errMessage = `HTTP ${response.status}`;
        try {
          const errData = await response.json();
          errMessage = errData.error || errMessage;
        } catch {
          const errText = await response.text();
          if (errText) errMessage = errText;
        }
        throw new Error(errMessage);
      }

      const data = await response.json();
      if (!data.segments || !Array.isArray(data.segments)) {
        throw new Error('伺服器未回傳有效的歌詞片段清單');
      }

      return data.segments;
    } catch (err: any) {
      lastError = err;
      // If it's a 404 on the first endpoint, try next
      if (err.message && err.message.includes('404')) {
        continue;
      }
      break;
    }
  }

  throw lastError || new Error('歌詞產生失敗，請稍後再試。');
}
