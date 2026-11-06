import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

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

const TRANSCRIPT_STORAGE_PREFIX = 'ea_transcript_';

/**
 * Get cached transcript from localStorage
 */
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

/**
 * Save transcript to localStorage
 */
export function saveCachedTranscript(transcript: TrackTranscript): void {
  try {
    localStorage.setItem(TRANSCRIPT_STORAGE_PREFIX + transcript.trackId, JSON.stringify(transcript));
  } catch (e) {
    console.warn('Failed to save transcript to localStorage:', e);
  }
}

/**
 * Decode an audio Blob to 16kHz mono Float32Array
 */
export async function decodeAudioTo16kHz(audioBlob: Blob): Promise<Float32Array> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();

  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const targetSampleRate = 16000;
    const duration = audioBuffer.duration;
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * targetSampleRate), targetSampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const rendered = await offlineCtx.startRendering();
    return rendered.getChannelData(0);
  } finally {
    if (audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
  }
}

/**
 * Fallback direct pipeline in main thread if Web Worker is unavailable
 */
let mainThreadPipelinePromise: Promise<any> | null = null;
async function getMainThreadTranscriber(onProgress?: (data: any) => void) {
  if (!mainThreadPipelinePromise) {
    mainThreadPipelinePromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      progress_callback: onProgress,
    });
  }
  return mainThreadPipelinePromise;
}

export interface TranscribeProgress {
  stage: 'downloading' | 'decoding' | 'transcribing' | 'completed' | 'error';
  message: string;
  percent?: number;
}

/**
 * Transcribe audio using Whisper in the browser (via Web Worker with main-thread fallback)
 */
export async function transcribeAudioWithWhisper(
  audioBlob: Blob,
  trackId: string,
  trackName: string,
  language = 'german',
  onProgress?: (progress: TranscribeProgress) => void
): Promise<TrackTranscript> {
  onProgress?.({
    stage: 'decoding',
    message: '正在將音訊轉換為 Whisper 格式 (16kHz)...',
  });

  const float32Data = await decodeAudioTo16kHz(audioBlob);

  onProgress?.({
    stage: 'downloading',
    message: '正在準備 Whisper 語音辨識模型 (約 39MB，僅首次需下載)...',
    percent: 0,
  });

  let rawOutput: any = null;

  // Attempt Web Worker first
  let workerUsed = false;
  try {
    if (typeof Worker !== 'undefined') {
      rawOutput = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/whisperWorker.ts', import.meta.url), {
          type: 'module',
        });

        worker.onmessage = (e: MessageEvent) => {
          const { status, data, output, error } = e.data || {};
          if (status === 'model-progress') {
            const pct = typeof data?.progress === 'number' ? Math.round(data.progress) : undefined;
            const fileName = data?.file || '';
            onProgress?.({
              stage: 'downloading',
              message: `下載語音模型中 ${fileName ? `(${fileName})` : ''} ${pct !== undefined ? `${pct}%` : ''}`,
              percent: pct,
            });
          } else if (status === 'transcribing') {
            onProgress?.({
              stage: 'transcribing',
              message: '正在使用 Whisper 辨識音檔內容 (德文)...',
            });
          } else if (status === 'complete') {
            worker.terminate();
            resolve(output);
          } else if (status === 'error') {
            worker.terminate();
            reject(new Error(error || 'Whisper 辨識錯誤'));
          }
        };

        worker.onerror = (err) => {
          worker.terminate();
          reject(err);
        };

        // Transfer float32Data buffer to worker
        worker.postMessage(
          {
            type: 'transcribe',
            audioData: float32Data,
            language,
          },
          [float32Data.buffer]
        );
      });
      workerUsed = true;
    }
  } catch (workerErr) {
    console.warn('Web Worker Whisper failed or unavailable, falling back to main thread:', workerErr);
    workerUsed = false;
  }

  // Fallback to main thread if worker didn't finish
  if (!workerUsed || !rawOutput) {
    onProgress?.({
      stage: 'downloading',
      message: '載入 Whisper 模型中...',
    });
    const transcriber = await getMainThreadTranscriber((data) => {
      const pct = typeof data?.progress === 'number' ? Math.round(data.progress) : undefined;
      onProgress?.({
        stage: 'downloading',
        message: `下載語音模型中 ${pct !== undefined ? `${pct}%` : ''}`,
        percent: pct,
      });
    });

    onProgress?.({
      stage: 'transcribing',
      message: '正在進行德文語音轉錄...',
    });

    rawOutput = await transcriber(float32Data, {
      language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });
  }

  // Parse segments/chunks from Whisper output
  const rawChunks = Array.isArray(rawOutput?.chunks) ? rawOutput.chunks : [];
  const segments: TranscriptSegment[] = rawChunks.map((chunk: any, index: number) => {
    const start = Array.isArray(chunk.timestamp) ? chunk.timestamp[0] ?? 0 : 0;
    const end = Array.isArray(chunk.timestamp) ? chunk.timestamp[1] ?? start + 3 : start + 3;
    return {
      id: index + 1,
      start: typeof start === 'number' ? start : 0,
      end: typeof end === 'number' ? end : start + 3,
      text: (chunk.text || '').trim(),
    };
  }).filter((s: TranscriptSegment) => s.text.length > 0);

  const fullText = (rawOutput?.text || segments.map((s: TranscriptSegment) => s.text).join(' ')).trim();

  const result: TrackTranscript = {
    trackId,
    trackName,
    fullText,
    segments,
    language,
    createdAt: Date.now(),
  };

  saveCachedTranscript(result);

  onProgress?.({
    stage: 'completed',
    message: '轉錄完成！',
    percent: 100,
  });

  return result;
}
