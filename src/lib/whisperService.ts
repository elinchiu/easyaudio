import { LyricSegment } from '../types/track';

export interface WhisperProgress {
  status: 'init' | 'loading' | 'progress' | 'transcribing' | 'complete' | 'error';
  message: string;
  percent?: number;
}

/**
 * Decode any browser-supported audio Blob into a 16kHz mono Float32Array suitable for Whisper
 */
export async function decodeAudioToFloat32Array(audioBlob: Blob): Promise<Float32Array> {
  const arrayBuffer = await audioBlob.arrayBuffer();

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('您的瀏覽器不支援 AudioContext 音訊解碼');
  }

  const audioCtx = new AudioContextClass();
  let audioBuffer: AudioBuffer;

  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (err: any) {
    throw new Error(`音訊解碼失敗：${err.message || '無法解析音訊格式'}`);
  } finally {
    await audioCtx.close();
  }

  // Resample to 16000 Hz mono
  const targetSampleRate = 16000;
  const numFrames = Math.max(1, Math.round(audioBuffer.duration * targetSampleRate));

  const offlineCtx = new OfflineAudioContext(1, numFrames, targetSampleRate);
  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = audioBuffer;
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer.getChannelData(0);
}

// Cached worker instance
let whisperWorker: Worker | null = null;

function getWorker(): Worker {
  if (!whisperWorker) {
    whisperWorker = new Worker(
      new URL('../workers/whisperWorker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return whisperWorker;
}

/**
 * Direct main-thread Whisper fallback in case Web Worker is unavailable or restricted
 */
async function transcribeMainThread(
  audioFloat32: Float32Array,
  language: string,
  onProgress?: (p: WhisperProgress) => void
): Promise<LyricSegment[]> {
  const { pipeline, env } = await import('@xenova/transformers');
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  onProgress?.({
    status: 'loading',
    message: '正在瀏覽器載入 Whisper 德文模型（約 39MB，首次需下載，後續永久快取）...',
    percent: 10,
  });

  const transcriber = await pipeline(
    'automatic-speech-recognition',
    'Xenova/whisper-tiny',
    {
      progress_callback: (data: any) => {
        if (data.status === 'progress' && typeof data.progress === 'number') {
          onProgress?.({
            status: 'progress',
            message: `正在下載 Whisper 模型：${Math.round(data.progress)}%`,
            percent: Math.round(data.progress),
          });
        }
      },
    }
  );

  onProgress?.({
    status: 'transcribing',
    message: 'Whisper 正在辨識德文音檔中...',
    percent: 100,
  });

  const output: any = await transcriber(audioFloat32, {
    language: language === 'auto' ? undefined : language || 'german',
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  return parseWhisperOutputToSegments(output);
}

/**
 * Convert Whisper output chunks into LyricSegment[]
 */
function parseWhisperOutputToSegments(output: any): LyricSegment[] {
  if (!output) return [];

  const chunks: any[] = output.chunks || [];
  if (chunks.length > 0) {
    return chunks
      .map((c) => {
        const start = Array.isArray(c.timestamp) ? c.timestamp[0] ?? 0 : 0;
        const end = Array.isArray(c.timestamp)
          ? c.timestamp[1] ?? start + 3
          : start + 3;
        return {
          startTime: Math.round(start * 100) / 100,
          endTime: Math.round(Math.max(start + 0.5, end) * 100) / 100,
          text: (c.text || '').trim(),
        };
      })
      .filter((s) => s.text.length > 0);
  }

  // Fallback if chunks are empty but text is returned
  const fullText = (output.text || '').trim();
  if (fullText) {
    const sentences = fullText
      .split(/(?<=[.?!;:\n])\s+/)
      .map((s: string) => s.trim())
      .filter(Boolean);

    if (sentences.length > 0) {
      const step = 4;
      return sentences.map((text: string, idx: number) => ({
        startTime: idx * step,
        endTime: (idx + 1) * step,
        text,
      }));
    }
  }

  return [];
}

/**
 * Transcribe an audio Blob using Whisper running 100% inside the browser
 */
export async function transcribeWithBrowserWhisper(
  audioBlob: Blob,
  options?: {
    language?: string;
    onProgress?: (progress: WhisperProgress) => void;
  }
): Promise<LyricSegment[]> {
  const language = options?.language || 'german';
  const onProgress = options?.onProgress;

  onProgress?.({
    status: 'init',
    message: '正在解碼音訊資料（16kHz Mono）...',
    percent: 5,
  });

  const audioFloat32 = await decodeAudioToFloat32Array(audioBlob);

  onProgress?.({
    status: 'loading',
    message: '啟動 Whisper 辨識程序...',
    percent: 15,
  });

  // Try Web Worker first
  try {
    const worker = getWorker();

    return await new Promise<LyricSegment[]>((resolve, reject) => {
      const handleMessage = (e: MessageEvent) => {
        const { status, message, data, output, error } = e.data;

        if (status === 'progress' && data) {
          if (typeof data.progress === 'number') {
            onProgress?.({
              status: 'progress',
              message: `正在下載 Whisper 模型：${Math.round(data.progress)}%`,
              percent: Math.round(data.progress),
            });
          }
        } else if (status === 'loading') {
          onProgress?.({
            status: 'loading',
            message: message || '正在載入 Whisper 德文模型...',
          });
        } else if (status === 'transcribing') {
          onProgress?.({
            status: 'transcribing',
            message: message || 'Whisper 正在辨識德文音檔中...',
            percent: 100,
          });
        } else if (status === 'complete') {
          worker.removeEventListener('message', handleMessage);
          const segments = parseWhisperOutputToSegments(output);
          resolve(segments);
        } else if (status === 'error') {
          worker.removeEventListener('message', handleMessage);
          reject(new Error(error || 'Whisper 辨識錯誤'));
        }
      };

      worker.addEventListener('message', handleMessage);

      // Post message with transferable Float32Array buffer
      worker.postMessage(
        {
          type: 'transcribe',
          audio: audioFloat32,
          language,
        },
        [audioFloat32.buffer]
      );
    });
  } catch (workerErr) {
    console.warn('Web Worker Whisper failed, falling back to main-thread Whisper:', workerErr);
    return await transcribeMainThread(audioFloat32, language, onProgress);
  }
}
