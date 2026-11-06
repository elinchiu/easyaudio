import { pipeline, env } from '@xenova/transformers';

// 不要去本站目錄找模型檔，一律從 Hugging Face 下載。
env.allowLocalModels = false;

// 把下載好的模型存進瀏覽器的 Cache Storage，下次辨識就不必重新下載。
// 注意：這不是離線功能。關掉的話，每次辨識都要重新下載整個模型（數十到數百 MB，依模型而定）。
env.useBrowserCache = true;

// 模型名稱與語言都由 whisper.ts 傳進來，這裡不寫死，換模型時不用改這個檔案。
// 語言為 'auto' 或未提供時，由 Whisper 自動偵測。
self.addEventListener('message', async (event: MessageEvent) => {
  const { type, audioData, language, model } = event.data || {};
  if (type !== 'transcribe') return;

  try {
    if (!model) throw new Error('沒有指定 Whisper 模型');
    if (!(audioData instanceof Float32Array) || audioData.length === 0) {
      throw new Error('沒有收到音訊資料');
    }

    // whisper.ts 每次辨識完都會把這個 worker 關掉（terminate），
    // 所以這裡不需要保存 pipeline；模型檔已存在瀏覽器 Cache，重新載入會比較快。
    const transcriber: any = await pipeline('automatic-speech-recognition', model, {
      progress_callback: (data: any) => self.postMessage({ status: 'model-progress', data }),
    });

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
});