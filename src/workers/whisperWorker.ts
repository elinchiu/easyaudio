import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

// Worker 讀不到 localStorage，無法自己判斷語言，
// 所以只回傳錯誤代碼（code），由主執行緒轉成使用者目前語言的訊息。
class WorkerError extends Error {
  code: 'noModel' | 'noAudio';
  constructor(code: 'noModel' | 'noAudio', message: string) {
    super(message);
    this.code = code;
  }
}

let loadedModel: string | null = null;
let transcriberPromise: Promise<any> | null = null;

function getTranscriber(model: string): Promise<any> {
  if (transcriberPromise && loadedModel === model) return transcriberPromise;

  loadedModel = model;
  const promise: Promise<any> = pipeline('automatic-speech-recognition', model, {
    progress_callback: (data: any) => self.postMessage({ status: 'model-progress', data }),
  });
  transcriberPromise = promise;

  promise.catch(() => {
    if (transcriberPromise === promise) {
      transcriberPromise = null;
      loadedModel = null;
    }
  });

  return promise;
}

async function handleTranscribe(data: any) {
  const { audioData, language, model } = data || {};

  try {
    if (!model) throw new WorkerError('noModel', 'No Whisper model specified');
    if (!(audioData instanceof Float32Array) || audioData.length === 0) {
      throw new WorkerError('noAudio', 'No audio data received');
    }

    const transcriber = await getTranscriber(model);

    self.postMessage({ status: 'transcribing' });

    const output = await transcriber(audioData, {
      ...(language && language !== 'auto' ? { language } : {}),
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });

    self.postMessage({ status: 'complete', output });
  } catch (err: any) {
    console.error('[Whisper Worker Error]', err);
    self.postMessage({
      status: 'error',
      code: err instanceof WorkerError ? err.code : undefined,
      error: err?.message || String(err),
    });
  }
}

let chain: Promise<void> = Promise.resolve();

self.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type !== 'transcribe') return;
  chain = chain.then(() => handleTranscribe(event.data));
});