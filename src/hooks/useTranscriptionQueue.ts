import { useState, useRef, useCallback, useEffect } from 'react';
import { AudioTrack } from '../types/track';
import {
  TrackTranscript,
  TranscribeProgress,
  getCachedTranscript,
  hasCachedTranscript,
  transcribeAudioWithWhisper,
} from '../lib/whisper';

/**
 * 語音辨識：一次只辨識使用者「正在播放（或正在看文字）」的那一首，不做批次。
 * 放在 App 最上層使用，所以就算文字面板關著，辨識也會在背景繼續跑。
 *
 * 使用者切到另一首時，前一首還沒辨識完的會被放棄，改辨識新的這一首（transcribeOnly），
 * 這樣不會花時間辨識使用者已經不在聽的音檔。
 */

export type TrackJobStatus = 'idle' | 'queued' | 'running' | 'error';

/** 辨識語言：本 App 主要處理德語音檔。要自動偵測改成 'auto'。 */
const TRANSCRIBE_LANGUAGE = 'german';

interface Params {
  /** 取得「指定音檔」的 Blob，不需要先播放它 */
  getTrackAudioBlob: (track: AudioTrack) => Promise<Blob | null>;
}

export function useTranscriptionQueue({ getTrackAudioBlob }: Params) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);
  const [queuedIds, setQueuedIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // 每完成一首就 +1，讓畫面知道要重新讀取文字
  const [version, setVersion] = useState(0);

  // 真正的「等候區」放在 ref 裡（同步讀寫，不會有 state 還沒更新的問題），state 只負責讓畫面更新。
  // 正常情況下裡面最多只有一首：剛被中止的前一首還在收尾時，新的這一首在這裡等它結束。
  const waitingRef = useRef<AudioTrack[]>([]);
  const pumpingRef = useRef(false);
  const currentIdRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const lastProgressKeyRef = useRef('');
  // 辨識結果也留一份在記憶體：就算 localStorage 滿了存不進去，這次開著的期間仍看得到
  const resultsRef = useRef<Map<string, TrackTranscript>>(new Map());

  const getBlobRef = useRef(getTrackAudioBlob);
  useEffect(() => {
    getBlobRef.current = getTrackAudioBlob;
  }, [getTrackAudioBlob]);

  const syncQueued = useCallback(() => {
    setQueuedIds(waitingRef.current.map((t) => t.id));
  }, []);

  const hasTranscript = (id: string) => resultsRef.current.has(id) || hasCachedTranscript(id);

  const getTranscript = useCallback(
    (id: string): TrackTranscript | null => resultsRef.current.get(id) ?? getCachedTranscript(id),
    []
  );

  // 依序處理等候區。同一時間只會有一個 pump 在跑。
  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;

    try {
      while (waitingRef.current.length > 0) {
        const track = waitingRef.current.shift()!;
        syncQueued();

        // 等候期間已經有結果了，直接略過
        if (hasTranscript(track.id)) continue;

        const controller = new AbortController();
        controllerRef.current = controller;
        currentIdRef.current = track.id;
        lastProgressKeyRef.current = '';
        setRunningId(track.id);
        setProgress({ stage: 'decoding', message: '正在讀取音訊檔...' });

        // 進度事件很密集，內容沒變就不要更新畫面
        const reportProgress = (p: TranscribeProgress) => {
          const key = `${p.stage}|${p.message}|${p.percent ?? ''}`;
          if (key === lastProgressKeyRef.current) return;
          lastProgressKeyRef.current = key;
          setProgress(p);
        };

        try {
          const blob = await getBlobRef.current(track);
          if (controller.signal.aborted) throw new DOMException('已取消辨識', 'AbortError');
          if (!blob) throw new Error('無法取得音檔內容，請確認檔案分享權限。');

          const result = await transcribeAudioWithWhisper(
            blob,
            track.id,
            track.name,
            TRANSCRIBE_LANGUAGE,
            reportProgress,
            controller.signal
          );

          resultsRef.current.set(track.id, result);
          setVersion((v) => v + 1);
        } catch (err: any) {
          // 使用者取消（或切到別首、換了資料夾）不算失敗，也不顯示錯誤
          if (err?.name !== 'AbortError') {
            console.error('Whisper transcription failed:', track.name, err);
            setErrors((prev) => ({
              ...prev,
              [track.id]: err?.message || '辨識失敗，請稍後再試。',
            }));
          }
        } finally {
          controllerRef.current = null;
          currentIdRef.current = null;
          setRunningId(null);
          setProgress(null);
        }
      }
    } finally {
      pumpingRef.current = false;
    }
  }, [syncQueued]);

  /**
   * 只辨識這一首：
   * - 已經有文字、或正在辨識這一首：什麼都不做
   * - 正在辨識的是別首：中止它（切歌就是放棄前一首）
   * - 等候區裡其他的音檔一律移除
   * - 之前辨識失敗的錯誤訊息會清掉，重新辨識
   */
  const transcribeOnly = useCallback(
    (track: AudioTrack) => {
      waitingRef.current = waitingRef.current.filter((t) => t.id === track.id);

      if (currentIdRef.current && currentIdRef.current !== track.id) {
        controllerRef.current?.abort();
      }

      // 正在辨識這一首（而且還沒被中止）就不用重排；
      // 如果它剛被中止、還在收尾（A → B → 又切回 A），要重新排隊
      const runningThisOne =
        currentIdRef.current === track.id && !controllerRef.current?.signal.aborted;
      const alreadyHandled =
        runningThisOne ||
        hasTranscript(track.id) ||
        waitingRef.current.some((t) => t.id === track.id);

      if (!alreadyHandled) {
        waitingRef.current.push(track);
        setErrors((prev) => {
          if (!prev[track.id]) return prev;
          const next = { ...prev };
          delete next[track.id];
          return next;
        });
      }

      syncQueued();
      void pump();
    },
    [pump, syncQueued]
  );

  /**
   * 只保留這份清單裡的音檔：不在清單裡的等候項目移除，正在辨識但不在清單裡的中止。
   * 匯入或重新整理資料夾時用：換了另一個資料夾，舊資料夾的辨識會被放棄；
   * 重新整理同一個資料夾則不會中斷正在跑的辨識。
   */
  const retainOnly = useCallback(
    (tracks: AudioTrack[]) => {
      const keep = new Set(tracks.map((t) => t.id));
      const before = waitingRef.current.length;
      waitingRef.current = waitingRef.current.filter((t) => keep.has(t.id));
      if (waitingRef.current.length !== before) syncQueued();
      if (currentIdRef.current && !keep.has(currentIdRef.current)) {
        controllerRef.current?.abort();
      }
    },
    [syncQueued]
  );

  /** 取消某一首：正在辨識的會中止，等候中的會被移除 */
  const cancelTrack = useCallback(
    (id: string) => {
      if (currentIdRef.current === id) {
        controllerRef.current?.abort();
        return;
      }
      const before = waitingRef.current.length;
      waitingRef.current = waitingRef.current.filter((t) => t.id !== id);
      if (waitingRef.current.length !== before) syncQueued();
    },
    [syncQueued]
  );

  // 元件被移除時：清空等候區、中止還在跑的辨識
  useEffect(
    () => () => {
      waitingRef.current = [];
      controllerRef.current?.abort();
    },
    []
  );

  const statusOf = useCallback(
    (id: string): TrackJobStatus => {
      if (runningId === id) return 'running';
      if (queuedIds.includes(id)) return 'queued';
      if (errors[id]) return 'error';
      return 'idle';
    },
    [runningId, queuedIds, errors]
  );

  return {
    runningId,
    progress,
    errors,
    version,
    statusOf,
    getTranscript,
    transcribeOnly,
    retainOnly,
    cancelTrack,
  };
}

export type TranscriptionQueue = ReturnType<typeof useTranscriptionQueue>;