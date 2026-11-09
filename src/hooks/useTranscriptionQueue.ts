import { useState, useRef, useCallback, useEffect } from 'react';
import { AudioTrack } from '../types/track';
import {
  TrackTranscript,
  TranscribeProgress,
  getCachedTranscript,
  hasCachedTranscript,
  transcribeAudioWithWhisper,
} from '../lib/whisper';

export type TrackJobStatus = 'idle' | 'queued' | 'running' | 'error';

const TRANSCRIBE_LANGUAGE = 'german';

interface Params {
  getTrackAudioBlob: (track: AudioTrack) => Promise<Blob | null>;
}

export function useTranscriptionQueue({ getTrackAudioBlob }: Params) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);
  const [queuedIds, setQueuedIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);

  const waitingRef = useRef<AudioTrack[]>([]);
  const pumpingRef = useRef(false);
  const currentIdRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const lastProgressKeyRef = useRef('');
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

  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;

    try {
      while (waitingRef.current.length > 0) {
        const track = waitingRef.current.shift()!;
        syncQueued();

        if (hasTranscript(track.id)) continue;

        const controller = new AbortController();
        controllerRef.current = controller;
        currentIdRef.current = track.id;
        lastProgressKeyRef.current = '';
        setRunningId(track.id);
        setProgress({ stage: 'decoding', message: '正在讀取音訊檔...' });

        const reportProgress = (p: TranscribeProgress) => {
          const key = `${p.stage}|${p.message}|${p.percent ?? ''}`;
          if (key === lastProgressKeyRef.current) return;
          lastProgressKeyRef.current = key;
          setProgress(p);
        };

        try {
          const blob = await getBlobRef.current(track);
          if (controller.signal.aborted) throw new DOMException('已取消辨識', 'AbortError');
          if (!blob) throw new Error('無法取得音檔內容，請稍後再試。');

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

  const transcribeOnly = useCallback(
    (track: AudioTrack) => {
      waitingRef.current = waitingRef.current.filter((t) => t.id === track.id);

      if (currentIdRef.current && currentIdRef.current !== track.id) {
        controllerRef.current?.abort();
      }

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