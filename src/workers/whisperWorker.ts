import { pipeline, env } from '@xenova/transformers';

// Disable loading models locally from filesystem in browser
env.allowLocalModels = false;
env.useBrowserCache = true;

class WhisperPipelineSingleton {
  static task = 'automatic-speech-recognition' as const;
  static model = 'Xenova/whisper-tiny';
  static instance: any = null;

  static async getInstance(onProgress?: (data: any) => void) {
    if (!this.instance) {
      this.instance = await pipeline(this.task, this.model, {
        progress_callback: onProgress,
      });
    }
    return this.instance;
  }
}

self.addEventListener('message', async (event: MessageEvent) => {
  const { type, audioData, language } = event.data || {};

  if (type === 'transcribe') {
    try {
      self.postMessage({ status: 'loading-model' });

      const transcriber = await WhisperPipelineSingleton.getInstance((progressData: any) => {
        self.postMessage({ status: 'model-progress', data: progressData });
      });

      self.postMessage({ status: 'transcribing' });

      // Run Whisper on the Float32Array 16kHz mono audio
      // Default language is 'german' (德文) as requested
      const output = await transcriber(audioData, {
        language: language || 'german',
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
});
