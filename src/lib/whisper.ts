export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface TrackTranscript {
  trackId: string;
  trackName: string;
  segments: TranscriptSegment[];
  language: string;
  createdAt: number;
}

export interface TranscribeProgress {
  stage: 'downloading' | 'decoding' | 'transcribing' | 'completed' | 'error';
  message: string;
  percent?: number;
}

const WHISPER_MODEL = 'Xenova/whisper-small';
const MODEL_DOWNLOAD_HINT = '約 250–290MB';

const MIN_TRACKED_FILE_BYTES = 5 * 1024 * 1024;

const TRANSCRIPT_STORAGE_PREFIX = 'ea_transcript_';

export function getCachedTranscript(trackId: string): TrackTranscript | null {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_STORAGE_PREFIX + trackId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to read cached transcript:', e);
    return null;
  }
}

export function hasCachedTranscript(trackId: string): boolean {
  try {
    return localStorage.getItem(TRANSCRIPT_STORAGE_PREFIX + trackId) !== null;
  } catch {
    return false;
  }
}

function saveCachedTranscript(transcript: TrackTranscript): void {
  try {
    localStorage.setItem(TRANSCRIPT_STORAGE_PREFIX + transcript.trackId, JSON.stringify(transcript));
  } catch (e) {
    console.warn('Failed to save transcript to localStorage:', e);
  }
}

async function decodeAudioTo16kHz(audioBlob: Blob): Promise<Float32Array> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('您的瀏覽器不支援 AudioContext 音訊解碼');
  }
  const audioCtx = new AudioContextClass();

  try {
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (err: any) {
      throw new Error(`音訊解碼失敗：${err?.message || '無法解析音訊格式'}`);
    }

    const targetSampleRate = 16000;
    const offlineCtx = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(audioBuffer.duration * targetSampleRate)),
      targetSampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const rendered = await offlineCtx.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    if (audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
  }
}

function abortError() {
  return new DOMException('已取消辨識', 'AbortError');
}

const WORKER_IDLE_MS = 60 * 1000;

let sharedWorker: Worker | null = null;
let sharedWorkerWarm = false;
let workerBusy = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function clearIdleTimer() {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function acquireWorker(): Worker {
  clearIdleTimer();
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('../workers/whisperWorker.ts', import.meta.url), {
      type: 'module',
    });
    sharedWorkerWarm = false;
  }
  return sharedWorker;
}

function terminateSharedWorker() {
  clearIdleTimer();
  if (sharedWorker) {
    sharedWorker.onmessage = null;
    sharedWorker.onerror = null;
    sharedWorker.onmessageerror = null;
    sharedWorker.terminate();
    sharedWorker = null;
  }
  sharedWorkerWarm = false;
}

function scheduleIdleShutdown() {
  clearIdleTimer();
  idleTimer = setTimeout(terminateSharedWorker, WORKER_IDLE_MS);
}

function runWhisperWorker(
  audio: Float32Array,
  language: string,
  onProgress?: (progress: TranscribeProgress) => void,
  signal?: AbortSignal
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    if (workerBusy) {
      reject(new Error('已有另一個辨識正在進行中'));
      return;
    }

    let worker: Worker;
    try {
      worker = acquireWorker();
    } catch (err: any) {
      console.error('Failed to create Whisper worker:', err);
      reject(new Error(`無法建立 Whisper Worker：${err?.message || String(err)}`));
      return;
    }
    workerBusy = true;

    const detach = () => {
      signal?.removeEventListener('abort', handleAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      workerBusy = false;
    };
    const succeed = (output: any) => {
      detach();
      scheduleIdleShutdown();
      resolve(output);
    };
    const fail = (error: Error) => {
      detach();
      terminateSharedWorker();
      reject(error);
    };
    const handleAbort = () => fail(abortError());
    signal?.addEventListener('abort', handleAbort);

    const files = new Map<string, { loaded: number; total: number }>();

    worker.onmessage = (e: MessageEvent) => {
      const { status, data, output, error } = e.data || {};

      if (status === 'model-progress') {
        const isProgress =
          data?.status === 'progress' &&
          typeof data.file === 'string' &&
          typeof data.loaded === 'number' &&
          typeof data.total === 'number';

        if (isProgress && data.total >= MIN_TRACKED_FILE_BYTES) {
          files.set(data.file, { loaded: data.loaded, total: data.total });

          let loaded = 0;
          let total = 0;
          files.forEach((f) => {
            loaded += f.loaded;
            total += f.total;
          });
          const percent = Math.min(100, Math.floor((loaded / total) * 100));

          onProgress?.({
            stage: 'downloading',
            message:
              percent >= 100
                ? '模型下載完成，正在載入模型...'
                : `正在下載語音辨識模型 ${percent}%`,
            percent,
          });
        }
      } else if (status === 'transcribing') {
        sharedWorkerWarm = true;
        onProgress?.({ stage: 'transcribing', message: '正在辨識音檔內容...' });
      } else if (status === 'complete') {
        succeed(output);
      } else if (status === 'error') {
        fail(new Error(error || 'Whisper 辨識錯誤'));
      }
    };

    worker.onerror = (e) => {
      console.error('Whisper Worker error event:', {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
      });
      fail(
        new Error(
          e.message ||
            `Whisper Worker 載入失敗（${
              e.filename || '找不到 Worker 檔案，請到 DevTools 的 Network 分頁檢查'
            }${e.lineno ? `:${e.lineno}` : ''}）`
        )
      );
    };

    worker.onmessageerror = () => {
      fail(new Error('Worker 訊息傳遞失敗'));
    };

    try {
      worker.postMessage(
        { type: 'transcribe', audioData: audio, language, model: WHISPER_MODEL },
        [audio.buffer]
      );
    } catch (err: any) {
      fail(new Error(`無法傳送音訊給 Worker：${err?.message || String(err)}`));
    }
  });
}

const NON_BREAKING_ABBREVIATIONS = new Set([
  'z.b', 'd.h', 'u.a', 'z.t', 'u.ä', 'o.ä', 'v.a', 'z.zt',
  'usw', 'bzw', 'ca', 'vgl', 'nr', 'dr', 'prof', 'hr', 'fr',
  'str', 'tel', 'evtl', 'ggf', 'inkl', 'sog', 'etc', 'bsp', 'abb',
]);

const SENTENCE_END_CHARS = '.!?…';
const CLOSING_CHARS = '"\'”“»«)]';

function isRealSentenceEndPeriod(text: string, i: number): boolean {
  const tokenStart = text.lastIndexOf(' ', i) + 1;
  const token = text
    .slice(tokenStart, i)
    .replace(/^[„"“«(\[]+/, '')
    .toLowerCase();
  if (/^\d{1,2}$/.test(token)) return false;
  if (NON_BREAKING_ABBREVIATIONS.has(token)) return false;
  return true;
}

function splitIntoSentenceSpans(text: string): { start: number; end: number }[] {
  const raw: { start: number; end: number }[] = [];
  let sentenceStart = 0;
  let i = 0;

  while (i < text.length) {
    if (!SENTENCE_END_CHARS.includes(text[i])) {
      i++;
      continue;
    }

    let j = i + 1;
    while (j < text.length && (SENTENCE_END_CHARS.includes(text[j]) || CLOSING_CHARS.includes(text[j]))) {
      j++;
    }

    const atBoundary = j >= text.length || /\s/.test(text[j]);
    if (atBoundary && (text[i] !== '.' || j - i > 1 || isRealSentenceEndPeriod(text, i))) {
      raw.push({ start: sentenceStart, end: j });
      sentenceStart = j;
    }
    i = j;
  }
  if (sentenceStart < text.length) raw.push({ start: sentenceStart, end: text.length });

  const spans: { start: number; end: number }[] = [];
  for (const r of raw) {
    let { start, end } = r;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end > start) spans.push({ start, end });
  }
  return spans;
}

interface SilenceRange {
  start: number;
  end: number;
}

const MIN_SILENCE_SECONDS = 1.2;

function findSilences(audio: Float32Array, sampleRate = 16000): SilenceRange[] {
  const frameSeconds = 0.05;
  const frameSize = Math.round(sampleRate * frameSeconds);
  const frameCount = Math.floor(audio.length / frameSize);
  if (frameCount < 10) return [];

  const rms = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let sum = 0;
    const offset = f * frameSize;
    for (let i = 0; i < frameSize; i++) {
      const v = audio[offset + i];
      sum += v * v;
    }
    rms[f] = Math.sqrt(sum / frameSize);
  }

  const sorted = Array.from(rms).sort((a, b) => a - b);
  const floor = sorted[Math.floor(frameCount * 0.05)];
  const speech = sorted[Math.floor(frameCount * 0.9)];
  if (speech < 0.001) return [];
  const threshold = floor + (speech - floor) * 0.1;

  const minFrames = Math.ceil(MIN_SILENCE_SECONDS / frameSeconds);
  const silences: SilenceRange[] = [];
  let runStart = -1;
  for (let f = 0; f <= frameCount; f++) {
    const silent = f < frameCount && rms[f] < threshold;
    if (silent && runStart < 0) {
      runStart = f;
    } else if (!silent && runStart >= 0) {
      if (f - runStart >= minFrames) {
        silences.push({ start: runStart * frameSeconds, end: f * frameSeconds });
      }
      runStart = -1;
    }
  }
  return silences;
}

function buildSentenceSegments(
  rawChunks: any[],
  audioSeconds: number,
  silences: SilenceRange[] = []
): TranscriptSegment[] {
  const chunks: { text: string; start: number; end: number }[] = [];
  for (const c of rawChunks) {
    const text = (c?.text || '').trim();
    if (!text) continue;
    const prevEnd = chunks.length ? chunks[chunks.length - 1].end : 0;
    const start = typeof c.timestamp?.[0] === 'number' ? c.timestamp[0] : prevEnd;
    const end = typeof c.timestamp?.[1] === 'number' ? c.timestamp[1] : start + 3;
    chunks.push({ text, start, end: Math.max(end, start + 0.1) });
  }
  if (chunks.length === 0) return [];

  let combined = '';
  const spans: { charStart: number; charEnd: number; start: number; end: number }[] = [];
  for (const c of chunks) {
    if (combined) combined += ' ';
    spans.push({
      charStart: combined.length,
      charEnd: combined.length + c.text.length,
      start: c.start,
      end: c.end,
    });
    combined += c.text;
  }

  const timeAt = (pos: number): number => {
    for (const s of spans) {
      if (pos <= s.charEnd) {
        const p = Math.max(pos, s.charStart);
        const ratio = (p - s.charStart) / Math.max(1, s.charEnd - s.charStart);
        return s.start + ratio * (s.end - s.start);
      }
    }
    return spans[spans.length - 1].end;
  };

  const charAt = (t: number): number => {
    for (const s of spans) {
      if (t < s.start) return s.charStart;
      if (t <= s.end) {
        const ratio = (t - s.start) / Math.max(0.001, s.end - s.start);
        return Math.round(s.charStart + ratio * (s.charEnd - s.charStart));
      }
    }
    return combined.length;
  };

  const snapToSpace = (pos: number, lo: number, hi: number): number => {
    for (let d = 0; d <= 20; d++) {
      for (const p of [pos - d, pos + d]) {
        if (p > lo && p < hi && combined[p] === ' ') return p;
      }
    }
    return -1;
  };

  const limit = audioSeconds > 0 ? audioSeconds : Infinity;
  const round = (n: number) => Math.round(n * 100) / 100;
  const segments: TranscriptSegment[] = [];

  for (const { start: cs, end: ce } of splitIntoSentenceSpans(combined)) {
    const sentStart = Math.min(timeAt(cs), limit);
    const sentEnd = Math.min(Math.max(timeAt(ce), sentStart), limit);

    const cuts: { pos: number; silence: SilenceRange }[] = [];
    let lastPos = cs;
    for (const sil of silences) {
      if (sil.start <= sentStart + 0.3 || sil.end >= sentEnd - 0.3) continue;
      const pos = snapToSpace(charAt((sil.start + sil.end) / 2), lastPos, ce);
      if (pos < 0) continue;
      cuts.push({ pos, silence: sil });
      lastPos = pos;
    }

    const bounds = [cs, ...cuts.map((c) => c.pos), ce];
    for (let k = 0; k < bounds.length - 1; k++) {
      const text = combined.slice(bounds[k], bounds[k + 1]).trim();
      if (!text) continue;

      let start = k === 0 ? sentStart : cuts[k - 1].silence.end;
      let end = k === bounds.length - 2 ? sentEnd : cuts[k].silence.start;

      const lead = silences.find((s) => s.start <= start + 0.5 && s.end > start && s.end < end);
      if (lead) start = lead.end;
      const trail = silences.find((s) => s.end >= end - 0.5 && s.start < end && s.start > start);
      if (trail) end = trail.start;

      const prevStart = segments.length ? segments[segments.length - 1].start : 0;
      start = Math.min(Math.max(start, prevStart), limit);
      end = Math.min(Math.max(end, start), limit);
      segments.push({ id: segments.length + 1, start: round(start), end: round(end), text });
    }
  }
  return segments;
}

export async function transcribeAudioWithWhisper(
  audioBlob: Blob,
  trackId: string,
  trackName: string,
  language = 'german',
  onProgress?: (progress: TranscribeProgress) => void,
  signal?: AbortSignal
): Promise<TrackTranscript> {
  onProgress?.({ stage: 'decoding', message: '正在轉換音訊格式（16kHz 單聲道）...' });

  const audio = await decodeAudioTo16kHz(audioBlob);
  if (audio.length === 0) {
    throw new Error('音檔解碼後是空的，無法辨識。');
  }
  const audioSeconds = audio.length / 16000;
  const silences = findSilences(audio);

  if (signal?.aborted) throw abortError();

  if (!sharedWorkerWarm) {
    onProgress?.({
      stage: 'downloading',
      message: `正在準備語音辨識模型（${MODEL_DOWNLOAD_HINT}，首次使用需下載，之後會保存在瀏覽器中）...`,
      percent: 0,
    });
  }

  const rawOutput = await runWhisperWorker(audio, language, onProgress, signal);

  const rawChunks = Array.isArray(rawOutput?.chunks) ? rawOutput.chunks : [];
  let segments = buildSentenceSegments(rawChunks, audioSeconds, silences);

  const rawText = (rawOutput?.text || '').trim();
  if (segments.length === 0 && rawText) {
    segments = buildSentenceSegments([{ text: rawText, timestamp: [0, audioSeconds] }], audioSeconds, silences);
  }

  const result: TrackTranscript = {
    trackId,
    trackName,
    segments,
    language,
    createdAt: Date.now(),
  };

  saveCachedTranscript(result);
  onProgress?.({ stage: 'completed', message: '轉錄完成！', percent: 100 });
  return result;
}