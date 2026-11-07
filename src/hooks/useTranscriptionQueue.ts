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
 * 語音辨識佇列：一次只辨識一首，其餘排隊。
 * 放在 App 最上層使用，所以就算文字面板關著，辨識也會在背景繼續跑。
 */

export type TrackJobStatus = 'idle' | 'queued' | 'running' | 'error';

/** 辨識語言：本 App 主要處理德語音檔。要自動偵測改成 'auto'。 */
const TRANSCRIBE_LANGUAGE = 'german';

/** 連續失敗這麼多首，就判斷是系統性問題（例如沒網路、模型載不下來），停止整個佇列 */
const MAX_CONSECUTIVE_FAILURES = 3;

export interface BatchStats {
  total: number;
  done: number;
  failed: number;
}

export interface EnqueueOptions {
  /** true：排到最前面（使用者手動要求辨識這一首時用） */
  priority?: boolean;
  /** true：把「不在這份清單裡」的排隊項目移除；正在辨識的若不在清單裡也會中止（匯入新資料夾時用） */
  replace?: boolean;
}

interface Params {
  /** 取得「指定音檔」的 Blob，不需要先播放它 */
  getTrackAudioBlob: (track: AudioTrack) => Promise<Blob | null>;
}

export function useTranscriptionQueue({ getTrackAudioBlob }: Params) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);
  const [queuedIds, setQueuedIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<BatchStats>({ total: 0, done: 0, failed: 0 });
  // 每完成一首就 +1，讓畫面知道要重新讀取文字
  const [version, setVersion] = useState(0);

  // 真正的「佇列」放在 ref 裡（同步讀寫，不會有 state 還沒更新的問題），state 只負責讓畫面更新
  const waitingRef = useRef<AudioTrack[]>([]);
  const pumpingRef = useRef(false);
  const currentIdRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const consecutiveFailuresRef = useRef(0);
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

  // 有音檔被移出佇列（取消、換資料夾）時，同步調整「共 N 首」的總數
  const shrinkTotal = useCallback((n: number) => {
    setBatch((b) => ({ ...b, total: Math.max(b.done + b.failed, b.total - n) }));
  }, []);

  const hasTranscript = (id: string) => resultsRef.current.has(id) || hasCachedTranscript(id);

  const getTranscript = useCallback(
    (id: string): TrackTranscript | null => resultsRef.current.get(id) ?? getCachedTranscript(id),
    []
  );

  // 依序處理佇列。同一時間只會有一個 pump 在跑。
  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;

    try {
      while (waitingRef.current.length > 0) {
        const track = waitingRef.current.shift()!;
        syncQueued();

        // 排隊期間已經有結果了，直接略過
        if (hasTranscript(track.id)) {
          setBatch((b) => ({ ...b, done: b.done + 1 }));
          continue;
        }

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
          consecutiveFailuresRef.current = 0;
          setBatch((b) => ({ ...b, done: b.done + 1 }));
          setVersion((v) => v + 1);
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            // 使用者取消（或換了資料夾）：不算失敗，也不算在總數裡
            shrinkTotal(1);
          } else {
            console.error('Whisper transcription failed:', track.name, err);
            setErrors((prev) => ({
              ...prev,
              [track.id]: err?.message || '辨識失敗，請稍後再試。',
            }));
            setBatch((b) => ({ ...b, failed: b.failed + 1 }));

            consecutiveFailuresRef.current += 1;
            if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
              const removed = waitingRef.current.length;
              console.warn(`連續 ${MAX_CONSECUTIVE_FAILURES} 首辨識失敗，停止後面的排隊辨識。`);
              waitingRef.current = [];
              consecutiveFailuresRef.current = 0;
              if (removed > 0) shrinkTotal(removed);
              syncQueued();
            }
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
  }, [syncQueued, shrinkTotal]);

  /** 把音檔加進辨識佇列。已經有文字的、已經在排隊或正在辨識的會自動略過。 */
  const enqueue = useCallback(
    (tracks: AudioTrack[], options: EnqueueOptions = {}) => {
      const { priority = false, replace = false } = options;

      if (replace) {
        const keep = new Set(tracks.map((t) => t.id));
        const before = waitingRef.current.length;
        waitingRef.current = waitingRef.current.filter((t) => keep.has(t.id));
        const removed = before - waitingRef.current.length;
        if (removed > 0) shrinkTotal(removed);
        if (currentIdRef.current && !keep.has(currentIdRef.current)) {
          controllerRef.current?.abort();
        }
      }

      // 佇列是不是空的：空的話，這是一批新的辨識，統計數字從 0 開始
      const wasIdle = !pumpingRef.current && waitingRef.current.length === 0;

      const seen = new Set<string>();
      const fresh: AudioTrack[] = [];
      for (const t of tracks) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        if (t.id === currentIdRef.current) continue; // 正在辨識這首
        if (hasTranscript(t.id)) continue; // 已經有文字了
        fresh.push(t);
      }

      let added = 0;
      if (priority) {
        // 插到最前面（已經在排隊的就移到最前面）
        const ids = new Set(fresh.map((t) => t.id));
        const alreadyWaiting = waitingRef.current.filter((w) => ids.has(w.id)).length;
        waitingRef.current = [...fresh, ...waitingRef.current.filter((w) => !ids.has(w.id))];
        added = fresh.length - alreadyWaiting;
      } else {
        const waitingIds = new Set(waitingRef.current.map((w) => w.id));
        const toAdd = fresh.filter((t) => !waitingIds.has(t.id));
        waitingRef.current = [...waitingRef.current, ...toAdd];
        added = toAdd.length;
      }

      if (added > 0) {
        setBatch((b) =>
          wasIdle ? { total: added, done: 0, failed: 0 } : { ...b, total: b.total + added }
        );
      }

      // 重新排進佇列的音檔，清掉上次的錯誤訊息
      if (fresh.length > 0) {
        setErrors((prev) => {
          if (!fresh.some((t) => prev[t.id])) return prev;
          const next = { ...prev };
          fresh.forEach((t) => delete next[t.id]);
          return next;
        });
      }

      syncQueued();
      void pump();
    },
    [pump, syncQueued, shrinkTotal]
  );

  /** 取消某一首：正在辨識的會中止（佇列繼續下一首），排隊中的會被移除 */
  const cancelTrack = useCallback(
    (id: string) => {
      if (currentIdRef.current === id) {
        controllerRef.current?.abort();
        return;
      }
      const before = waitingRef.current.length;
      waitingRef.current = waitingRef.current.filter((t) => t.id !== id);
      if (waitingRef.current.length !== before) {
        shrinkTotal(1);
        syncQueued();
      }
    },
    [shrinkTotal, syncQueued]
  );

  /** 取消全部：清空佇列，並中止正在辨識的那首 */
  const cancelAll = useCallback(() => {
    const removed = waitingRef.current.length;
    waitingRef.current = [];
    if (removed > 0) shrinkTotal(removed);
    syncQueued();
    controllerRef.current?.abort();
  }, [shrinkTotal, syncQueued]);

  /** 如果這首還在排隊，就把它移到最前面（使用者開始播放它時用） */
  const prioritizeIfQueued = useCallback(
    (id: string) => {
      const index = waitingRef.current.findIndex((t) => t.id === id);
      if (index <= 0) return;
      const [track] = waitingRef.current.splice(index, 1);
      waitingRef.current.unshift(track);
      syncQueued();
    },
    [syncQueued]
  );

  // 元件被移除時：清空佇列、中止還在跑的辨識
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
    queuedIds,
    errors,
    batch,
    version,
    isActive: runningId !== null || queuedIds.length > 0,
    statusOf,
    getTranscript,
    enqueue,
    cancelTrack,
    cancelAll,
    prioritizeIfQueued,
  };
}

export type TranscriptionQueue = ReturnType<typeof useTranscriptionQueue>;
