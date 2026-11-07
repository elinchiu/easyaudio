import { pipeline, env } from '@xenova/transformers';

// 不要去本站目錄找模型檔，一律從 Hugging Face 下載。
env.allowLocalModels = false;

// 把下載好的模型存進瀏覽器的 Cache Storage，下次辨識就不必重新下載。
// 注意：這不是離線功能。關掉的話，每次辨識都要重新下載整個模型（數十到數百 MB，依模型而定）。
env.useBrowserCache = true;

// ───────────────────────── 模型只載入一次 ─────────────────────────
// whisper.ts 現在會讓同一個 worker 連續處理好幾首音檔（批次辨識），
// 所以把載入好的 pipeline 留在這裡，第二首之後就不必重新把模型載入記憶體。
// worker 被 terminate（取消、出錯、閒置太久）時，這些變數會跟著消失，下次會重新載入。
let loadedModel: string | null = null;
let transcriberPromise: Promise<any> | null = null;

function getTranscriber(model: string): Promise<any> {
  if (transcriberPromise && loadedModel === model) return transcriberPromise;

  loadedModel = model;
  const promise: Promise<any> = pipeline('automatic-speech-recognition', model, {
    progress_callback: (data: any) => self.postMessage({ status: 'model-progress', data }),
  });
  transcriberPromise = promise;

  // 載入失敗就不要留著失敗的結果，下一首重新嘗試
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

    // audioData 是 16kHz 單聲道的 Float32Array
    const output = await transcriber(audioData, {
      // 'auto'（或沒給）時不傳 language，讓 Whisper 自己偵測；
      // 把 'auto' 這個字串直接傳進去會報錯。
      ...(language && language !== 'auto' ? { language } : {}),
      task: 'transcribe',
      // Whisper 一次只能處理 30 秒，長音檔要切成多段；
      // 相鄰兩段重疊 5 秒，避免句子剛好在切點被截斷。
      chunk_length_s: 30,
      stride_length_s: 5,
      // 回傳每一句的起訖秒數，TranscriptModal 靠它做逐句高亮與跳轉
      return_timestamps: true,
    });

    self.postMessage({ status: 'complete', output });
  } catch (err: any) {
    console.error('[Whisper Worker Error]', err);
    self.postMessage({ status: 'error', error: err?.message || String(err) });
  }
}

// 訊息一律排隊、一次處理一個。handleTranscribe 內部已經接住所有錯誤，所以這條鏈不會中斷。
let chain: Promise<void> = Promise.resolve();

self.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type !== 'transcribe') return;
  chain = chain.then(() => handleTranscribe(event.data));
});