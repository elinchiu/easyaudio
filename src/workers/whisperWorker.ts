import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

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
    if (!model) throw new Error('沒有指定 Whisper 模型');
    if (!(audioData instanceof Float32Array) || audioData.length === 0) {
      throw new Error('沒有收到音訊資料');
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
    self.postMessage({ status: 'error', error: err?.message || String(err) });
  }
}

let chain: Promise<void> = Promise.resolve();

self.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type !== 'transcribe') return;
  chain = chain.then(() => handleTranscribe(event.data));
});