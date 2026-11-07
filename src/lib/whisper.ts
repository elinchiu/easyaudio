export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface TrackTranscript {
  trackId: string;
  trackName: string;
  fullText: string;
  segments: TranscriptSegment[];
  language: string;
  createdAt: number;
}

export interface TranscribeProgress {
  stage: 'downloading' | 'decoding' | 'transcribing' | 'completed' | 'error';
  message: string;
  percent?: number;
}

// 使用的 Whisper 模型（量化版）。要換模型只需要改這兩行：
//   whisper-tiny  下載量約 40MB，速度最快，但準確度較低
//   whisper-base  下載量約 80–100MB，速度快、準確度普通
//   whisper-small 下載量約 250–290MB，準確度明顯較好，但較慢、較吃記憶體
const WHISPER_MODEL = 'Xenova/whisper-small';
const MODEL_DOWNLOAD_HINT = '約 250–290MB';

// 下載進度只統計大於這個大小的檔案（也就是真正的模型檔），
// 否則幾 KB 的設定檔一下載完，進度條就會先衝到 100%。
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

/** 只檢查有沒有存過，不解析內容（批次辨識要快速掃過整個資料夾時用） */
export function hasCachedTranscript(trackId: string): boolean {
  try {
    return localStorage.getItem(TRANSCRIPT_STORAGE_PREFIX + trackId) !== null;
  } catch {
    return false;
  }
}

export function saveCachedTranscript(transcript: TrackTranscript): void {
  try {
    localStorage.setItem(TRANSCRIPT_STORAGE_PREFIX + transcript.trackId, JSON.stringify(transcript));
  } catch (e) {
    console.warn('Failed to save transcript to localStorage:', e);
  }
}

/**
 * 把音檔 Blob 解碼成 Whisper 需要的 16kHz 單聲道 Float32Array
 */
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
    // OfflineAudioContext 是 Web Audio 的「非即時渲染」（不經過喇叭、一次算完），
    // 在這裡只是拿來重新取樣成 16kHz 並混成單聲道，跟 App 有沒有網路無關。
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
    // getChannelData 回傳的是 AudioBuffer 內部資料的檢視；
    // slice() 複製成獨立的資料，之後轉移給 Worker 才不會有問題。
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

// ───────────────────────── 共用 Worker ─────────────────────────
// 批次辨識時，連續好幾首音檔共用同一個 Worker：模型只需要載入一次。
// - 辨識成功：Worker 保留著，閒置超過 WORKER_IDLE_MS 才關閉（釋放記憶體）
// - 取消或出錯：直接關閉（取消運算只能靠關掉 Worker），下一首會重新建立
// 一次只允許一個辨識在跑，批次佇列（useTranscriptionQueue）會確保這一點。

const WORKER_IDLE_MS = 60 * 1000;

let sharedWorker: Worker | null = null;
let sharedWorkerWarm = false; // 這個 Worker 已經載入過模型
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

/**
 * 在 Web Worker 裡跑 Whisper。
 * 傳入 signal 可以中途取消（會直接 terminate worker）。
 * language 為 'auto' 時，由 worker 不指定語言，讓 Whisper 自動偵測。
 */
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

    // 這一次辨識結束：拆掉事件監聽（Worker 本身不一定要關）
    const detach = () => {
      signal?.removeEventListener('abort', handleAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      workerBusy = false;
    };
    // 成功：保留 Worker 給下一首用，閒置一陣子才關
    const succeed = (output: any) => {
      detach();
      scheduleIdleShutdown();
      resolve(output);
    };
    // 失敗或取消：Worker 的狀態不確定（或必須中斷運算），直接關掉
    const fail = (error: Error) => {
      detach();
      terminateSharedWorker();
      reject(error);
    };
    const handleAbort = () => fail(abortError());
    signal?.addEventListener('abort', handleAbort);

    // 模型由好幾個檔案組成，各自回報進度；這裡把它們合計成一條進度條
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
        sharedWorkerWarm = true; // 模型已經載入完成
        onProgress?.({
          stage: 'transcribing',
          message:
            language === 'auto'
              ? '正在辨識音檔內容...'
              : '正在辨識音檔內容...',
        });
      } else if (status === 'complete') {
        succeed(output);
      } else if (status === 'error') {
        fail(new Error(error || 'Whisper 辨識錯誤'));
      }
    };

    // Worker 腳本本身載入或執行失敗時會觸發（例如檔案 404、打包錯誤、
    // 模組在最上層就丟出例外）。瀏覽器經常不給 message，所以把能拿到的資訊都印出來。
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

    // 用「轉移」而不是「複製」把音訊交給 worker，可以省下一份記憶體
    // （轉移之後，這邊的 audio 就變成空的，不能再使用）
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

// ───────────────────────── 斷句 ─────────────────────────
// Whisper 回傳的「段落」是依 30 秒視窗與它自己的判斷切的，不一定剛好是一句話：
// 常見狀況是一段裡有好幾句，或一句話被切在兩段之間。
// 所以這裡先把所有段落接成一整段文字，再依標點重新切成「一句一行」，
// 每句的起訖時間，用它在原本段落裡的字元位置按比例推算。

// 德文常見縮寫：句點接在這些詞後面時，不算句子結束
const NON_BREAKING_ABBREVIATIONS = new Set([
  'z.b', 'd.h', 'u.a', 'z.t', 'u.ä', 'o.ä', 'v.a', 'z.zt',
  'usw', 'bzw', 'ca', 'vgl', 'nr', 'dr', 'prof', 'hr', 'fr',
  'str', 'tel', 'evtl', 'ggf', 'inkl', 'sog', 'etc', 'bsp', 'abb',
]);

const SENTENCE_END_CHARS = '.!?…';
const CLOSING_CHARS = '"\'”“»«)]';

/** 判斷位置 i 的句點是不是真的句尾（排除序數「3. Mai」與縮寫「z.B.」） */
function isRealSentenceEndPeriod(text: string, i: number): boolean {
  const tokenStart = text.lastIndexOf(' ', i) + 1;
  const token = text
    .slice(tokenStart, i)
    .replace(/^[„"“«(\[]+/, '')
    .toLowerCase();
  if (/^\d{1,2}$/.test(token)) return false; // 序數，例如「am 3. Mai」（4 位數的年份結尾仍會斷句）
  if (NON_BREAKING_ABBREVIATIONS.has(token)) return false;
  return true;
}

/** 依標點把文字切成句子，回傳每句的字元範圍（已去掉前後空白） */
function splitIntoSentenceSpans(text: string): { start: number; end: number }[] {
  const raw: { start: number; end: number }[] = [];
  let sentenceStart = 0;
  let i = 0;

  while (i < text.length) {
    if (!SENTENCE_END_CHARS.includes(text[i])) {
      i++;
      continue;
    }

    // 吃掉連續的結束標點（?!、...）與緊接的結尾引號
    let j = i + 1;
    while (j < text.length && (SENTENCE_END_CHARS.includes(text[j]) || CLOSING_CHARS.includes(text[j]))) {
      j++;
    }

    // 標點後面必須是空白或結尾，才算句尾（避免切到 8.30、z.B）
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

// ───────────────────── 靜音偵測 ─────────────────────
// Whisper 的時間只到「段落」層級，看不到段落「裡面」的長空檔。
// 所以直接分析音檔的音量：找出夠長的安靜區間，用它來
//   1. 把中間有長空檔的句子切成兩段（空檔後的內容是新的一段）
//   2. 把每句的開始／結束時間貼齊到真正開口、收聲的位置
// 這些只靠音量判斷，跟模型無關。

interface SilenceRange {
  start: number;
  end: number;
}

// 安靜超過這麼久，才算「很長的空檔」。覺得切太碎就調大（例如 2），切不夠就調小（例如 0.8）
const MIN_SILENCE_SECONDS = 1.2;

function findSilences(audio: Float32Array, sampleRate = 16000): SilenceRange[] {
  const frameSeconds = 0.05;
  const frameSize = Math.round(sampleRate * frameSeconds);
  const frameCount = Math.floor(audio.length / frameSize);
  if (frameCount < 10) return [];

  // 每 50 毫秒算一次音量（RMS）
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

  // 門檻依這個音檔自己的音量決定：底噪 + 說話音量與底噪差距的 10%
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const floor = sorted[Math.floor(frameCount * 0.05)];
  const speech = sorted[Math.floor(frameCount * 0.9)];
  if (speech < 0.001) return []; // 整段幾乎沒聲音，無從判斷
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

/** 把 Whisper 的段落重新整理成「一句一行 + 起訖秒數」 */
function buildSentenceSegments(
  rawChunks: any[],
  audioSeconds: number,
  silences: SilenceRange[] = []
): TranscriptSegment[] {
  // 1. 整理每個段落的時間
  const chunks: { text: string; start: number; end: number }[] = [];
  for (const c of rawChunks) {
    const text = (c?.text || '').trim();
    if (!text) continue;
    const prevEnd = chunks.length ? chunks[chunks.length - 1].end : 0;
    const start = typeof c.timestamp?.[0] === 'number' ? c.timestamp[0] : prevEnd;
    // Whisper 最後一句的結束時間可能是 null，這時先假設這句長 3 秒
    const end = typeof c.timestamp?.[1] === 'number' ? c.timestamp[1] : start + 3;
    chunks.push({ text, start, end: Math.max(end, start + 0.1) });
  }
  if (chunks.length === 0) return [];

  // 2. 把所有段落接成一整段文字，並記下每段在文字中的位置
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

  // 3. 字元位置 → 秒數（在所屬段落的起訖時間之間按比例推算）
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

  // 3b. 秒數 → 字元位置（反向換算）：某個時間點大約對應文字的哪裡
  const charAt = (t: number): number => {
    for (const s of spans) {
      if (t < s.start) return s.charStart; // 落在兩個段落之間的空檔：文字邊界就是下一段的開頭
      if (t <= s.end) {
        const ratio = (t - s.start) / Math.max(0.001, s.end - s.start);
        return Math.round(s.charStart + ratio * (s.charEnd - s.charStart));
      }
    }
    return combined.length;
  };

  // 把位置挪到最近的空白，避免把單字切成兩半；找不到回傳 -1
  const snapToSpace = (pos: number, lo: number, hi: number): number => {
    for (let d = 0; d <= 20; d++) {
      for (const p of [pos - d, pos + d]) {
        if (p > lo && p < hi && combined[p] === ' ') return p;
      }
    }
    return -1;
  };

  // 4. 切句，並確保時間由小到大、不超過音檔長度
  const limit = audioSeconds > 0 ? audioSeconds : Infinity;
  const round = (n: number) => Math.round(n * 100) / 100;
  const segments: TranscriptSegment[] = [];

  for (const { start: cs, end: ce } of splitIntoSentenceSpans(combined)) {
    const sentStart = Math.min(timeAt(cs), limit);
    const sentEnd = Math.min(Math.max(timeAt(ce), sentStart), limit);

    // 句子中間如果有很長的靜音，就在那裡切開：空檔後面的內容是新的一段
    const cuts: { pos: number; silence: SilenceRange }[] = [];
    let lastPos = cs;
    for (const sil of silences) {
      if (sil.start <= sentStart + 0.3 || sil.end >= sentEnd - 0.3) continue; // 只處理句子「中間」的空檔
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

      // 貼齊真正開口、收聲的位置：開頭落在靜音裡就移到靜音結束，結尾同理
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

/**
 * 在瀏覽器中用 Whisper 辨識音檔
 * language 預設為 'german'（本 App 專門處理德語音檔）；
 * 要自動偵測可傳 'auto'，其他語言可傳 'english' 等。
 */
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
  const audioSeconds = audio.length / 16000; // 要在轉移給 worker 之前先算好長度
  const silences = findSilences(audio); // 同理，轉移之後 audio 就是空的，要先分析好靜音位置

  if (signal?.aborted) throw abortError();

  // 共用的 Worker 已經載入過模型時（批次辨識的第二首以後），不用再顯示「準備模型」
  if (!sharedWorkerWarm) {
    onProgress?.({
      stage: 'downloading',
      message: `正在準備語音辨識模型（${MODEL_DOWNLOAD_HINT}，首次使用需下載，之後會保存在瀏覽器中）...`,
      percent: 0,
    });
  }

  const rawOutput = await runWhisperWorker(audio, language, onProgress, signal);

  // 把 Whisper 的輸出重新斷句成「一句一行 + 起訖秒數」
  const rawChunks = Array.isArray(rawOutput?.chunks) ? rawOutput.chunks : [];
  let segments = buildSentenceSegments(rawChunks, audioSeconds, silences);

  // 沒有逐段時間、只有整段文字：把它當成涵蓋整首的一段，再依標點切句、按字數分配時間
  const rawText = (rawOutput?.text || '').trim();
  if (segments.length === 0 && rawText) {
    segments = buildSentenceSegments([{ text: rawText, timestamp: [0, audioSeconds] }], audioSeconds, silences);
  }

  // 純文字檢視、複製、下載 .txt 都用這個：一句一行
  const fullText = segments.map((s) => s.text).join('\n');

  const result: TrackTranscript = {
    trackId,
    trackName,
    fullText,
    segments,
    language,
    createdAt: Date.now(),
  };

  saveCachedTranscript(result);
  onProgress?.({ stage: 'completed', message: '轉錄完成！', percent: 100 });
  return result;
}