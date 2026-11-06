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
//   whisper-base  下載量約 80–100MB，速度快、準確度普通
//   whisper-small 下載量約 250–290MB，準確度明顯較好，但較慢、較吃記憶體
const WHISPER_MODEL = 'Xenova/whisper-small';
const MODEL_DOWNLOAD_HINT = '約 250MB';

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
  const audioCtx = new AudioContextClass();

  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const targetSampleRate = 16000;
    // OfflineAudioContext 是 Web Audio 的「非即時渲染」（不經過喇叭、一次算完），
    // 在這裡只是拿來重新取樣成 16kHz 並混成單聲道，跟 App 有沒有網路無關。
    const offlineCtx = new OfflineAudioContext(
      1,
      Math.ceil(audioBuffer.duration * targetSampleRate),
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

/**
 * 在 Web Worker 裡跑 Whisper。
 * 傳入 signal 可以中途取消（會直接 terminate worker）。
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

    const worker = new Worker(new URL('../workers/whisperWorker.ts', import.meta.url), {
      type: 'module',
    });

    const finish = () => {
      signal?.removeEventListener('abort', handleAbort);
      worker.terminate();
    };
    const handleAbort = () => {
      finish();
      reject(abortError());
    };
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
        onProgress?.({ stage: 'transcribing', message: '正在辨識音檔內容（德文）...' });
      } else if (status === 'complete') {
        finish();
        resolve(output);
      } else if (status === 'error') {
        finish();
        reject(new Error(error || 'Whisper 辨識錯誤'));
      }
    };

    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || 'Whisper Worker 載入失敗'));
    };

    // 用「轉移」而不是「複製」把音訊交給 worker，可以省下一份記憶體
    // （轉移之後，這邊的 audio 就變成空的，不能再使用）
    worker.postMessage(
      { type: 'transcribe', audioData: audio, language, model: WHISPER_MODEL },
      [audio.buffer]
    );
  });
}

/**
 * 在瀏覽器中用 Whisper 辨識音檔
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

  if (signal?.aborted) throw abortError();

  onProgress?.({
    stage: 'downloading',
    message: `正在準備語音辨識模型（${MODEL_DOWNLOAD_HINT}，首次使用需下載，之後會保存在瀏覽器中）...`,
    percent: 0,
  });

  const rawOutput = await runWhisperWorker(audio, language, onProgress, signal);

  // 把 Whisper 的輸出整理成「每一句 + 起訖秒數」
  const rawChunks = Array.isArray(rawOutput?.chunks) ? rawOutput.chunks : [];
  let segments: TranscriptSegment[] = rawChunks
    .map((chunk: any, index: number) => {
      const start = typeof chunk.timestamp?.[0] === 'number' ? chunk.timestamp[0] : 0;
      // Whisper 最後一句的結束時間可能是 null，這時先假設這句長 3 秒
      const end = typeof chunk.timestamp?.[1] === 'number' ? chunk.timestamp[1] : start + 3;
      return { id: index + 1, start, end, text: (chunk.text || '').trim() };
    })
    .filter((s: TranscriptSegment) => s.text.length > 0);

  const fullText = (rawOutput?.text || segments.map((s) => s.text).join(' ')).trim();

  // 有文字但沒有逐句時間：至少留一個涵蓋整首的段落，畫面才不會是空的
  if (segments.length === 0 && fullText) {
    segments = [{ id: 1, start: 0, end: audioSeconds, text: fullText }];
  }

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