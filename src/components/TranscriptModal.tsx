import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AudioTrack } from '../types/track';
import {
  TranscriptSegment,
  TrackTranscript,
  getCachedTranscript,
  saveCachedTranscript,
  transcribeAudioWithWhisper,
  TranscribeProgress,
} from '../lib/whisper';
import {
  FileText,
  X,
  Play,
  Copy,
  Check,
  Download,
  Edit3,
  RotateCcw,
  AlertCircle,
  Search,
  Sparkles,
  Layers,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: AudioTrack | null;
  currentTime: number;
  /** 目前音檔的總長度（秒）。貼上課本文字時，用來把時間分配給每一行 */
  duration: number;
  onSeek: (time: number) => void;
  /** 取得目前播放中音檔的 Blob（交給 Whisper 辨識用） */
  getAudioBlob: () => Promise<Blob | null>;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** 把逐句段落轉成「一行一句」的文字，給編輯框使用 */
function segmentsToText(transcript: TrackTranscript | null): string {
  return (transcript?.segments ?? []).map((s) => s.text).join('\n');
}

/**
 * 把使用者編輯後的文字轉回逐句段落。
 * - 行數沒變（通常只是改錯字）：沿用原本每一句的時間。
 * - 行數改變（例如貼上課本文字）：原本的時間對不上了，
 *   改成依每行字數的比例，把整首音檔的時間分配給每一行（只是大概對齊）。
 */
function buildSegmentsFromText(
  text: string,
  previous: TranscriptSegment[],
  duration: number
): TranscriptSegment[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length > 0 && lines.length === previous.length) {
    return lines.map((t, i) => ({ id: i + 1, start: previous[i].start, end: previous[i].end, text: t }));
  }

  const totalSeconds = duration > 0 ? duration : lines.length * 5; // 不知道總長度時，每行先抓 5 秒
  const totalChars = lines.reduce((sum, l) => sum + l.length, 0) || 1;
  let cursor = 0;
  return lines.map((t, i) => {
    const start = cursor;
    cursor += (t.length / totalChars) * totalSeconds;
    return { id: i + 1, start, end: cursor, text: t };
  });
}

export const TranscriptModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentTrack,
  currentTime,
  duration,
  onSeek,
  getAudioBlob,
}) => {
  const trackId = currentTrack?.id ?? null;

  const [transcript, setTranscript] = useState<TrackTranscript | null>(null);
  // 正在進行的辨識工作。同一時間只允許一個，並記下它是哪一首的
  const [job, setJob] = useState<{ trackId: string; progress: TranscribeProgress | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 顯示模式：'synced' 逐句對照 / 'text' 純文字
  const [viewMode, setViewMode] = useState<'synced' | 'text'>('synced');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  // 手動編輯
  const [isEditing, setIsEditing] = useState(false);
  const [manualText, setManualText] = useState('');

  const activeSegmentRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 辨識是非同步的：完成時要確認使用者還停在同一首，才能更新畫面
  const currentTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentTrackIdRef.current = trackId;
  }, [trackId]);

  // 元件被移除時，取消還在跑的辨識
  useEffect(() => () => abortRef.current?.abort(), []);

  // 開啟視窗或切歌時，讀取這首歌已存的文字
  useEffect(() => {
    if (!trackId || !isOpen) return;
    setTranscript(getCachedTranscript(trackId));
    setError(null);
    setIsEditing(false);
    setSearchQuery('');
  }, [trackId, isOpen]);

  // 目前播放到哪一句：開始時間不晚於目前時間的最後一句
  const activeId = useMemo(() => {
    let id: number | null = null;
    for (const seg of transcript?.segments ?? []) {
      if (seg.start <= currentTime) id = seg.id;
      else break;
    }
    return id;
  }, [transcript, currentTime]);

  // 只有「換到另一句」時才捲動；不要每次播放時間更新都捲
  useEffect(() => {
    if (!isOpen || viewMode !== 'synced' || activeId === null) return;
    activeSegmentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeId, viewMode, isOpen]);

  if (!isOpen || !currentTrack) return null;

  const isTranscribing = job?.trackId === currentTrack.id;
  const isBusyWithOtherTrack = !!job && job.trackId !== currentTrack.id;

  const handleStartTranscribe = async () => {
    if (job) return;
    if (
      transcript &&
      !window.confirm('重新辨識會覆蓋目前的文字（包含你手動編輯過的內容），確定要繼續嗎？')
    ) {
      return;
    }

    const { id, name } = currentTrack;
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setJob({ trackId: id, progress: { stage: 'decoding', message: '正在讀取音訊檔...' } });

    try {
      const audioBlob = await getAudioBlob();
      if (!audioBlob) throw new Error('無法取得音檔內容，請確認檔案分享權限。');
      if (controller.signal.aborted) return;

      // language 傳 undefined，使用 whisper.ts 的預設值 'auto'（自動偵測語言）
      const result = await transcribeAudioWithWhisper(
        audioBlob,
        id,
        name,
        undefined,
        (progress) => setJob((j) => (j && j.trackId === id ? { ...j, progress } : j)),
        controller.signal
      );

      // 結果已經存進快取。只有使用者還停在這一首時，才更新畫面
      if (currentTrackIdRef.current === id) setTranscript(result);
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // 使用者按了取消
      console.error('Whisper transcription failed:', err);
      if (currentTrackIdRef.current === id) {
        setError(err?.message || '辨識失敗，請稍後再試。');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setJob(null);
    }
  };

  const handleCancelTranscribe = () => abortRef.current?.abort();

  const handleStartEditing = () => {
    setManualText(segmentsToText(transcript));
    setIsEditing(true);
  };

  const handleStartPasting = () => {
    setManualText('');
    setIsEditing(true);
  };

  const handleSaveManualEdit = () => {
    if (!manualText.trim()) return;

    const segments = buildSegmentsFromText(manualText, transcript?.segments ?? [], duration);
    const updated: TrackTranscript = {
      trackId: currentTrack.id,
      trackName: currentTrack.name,
      fullText: segments.map((s) => s.text).join('\n'),
      segments,
      language: transcript?.language ?? 'auto',
      createdAt: Date.now(),
    };

    saveCachedTranscript(updated);
    setTranscript(updated);
    setIsEditing(false);
  };

  const handleCopyText = async () => {
    if (!transcript?.fullText) return;
    try {
      await navigator.clipboard.writeText(transcript.fullText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (e) {
      console.warn('Copy failed:', e);
    }
  };

  const handleDownloadTxt = () => {
    if (!transcript?.fullText) return;
    const blob = new Blob([transcript.fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentTrack.name.replace(/\.[^/.]+$/, '')}_文字.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredSegments = (transcript?.segments || []).filter((seg) => {
    if (!searchQuery.trim()) return true;
    return seg.text.toLowerCase().includes(searchQuery.trim().toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-2xl h-[88vh] max-h-[750px] rounded-3xl bg-white border border-slate-200 shadow-2xl flex flex-col text-slate-800 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#E0F8C7] text-[#36415A] flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 truncate">音檔文字</h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#E0F8C7] text-[#36415A] border border-[#BFE0A3]">
                  Whisper 多語言自動偵測
                </span>
              </div>
              <p className="text-xs text-slate-500 truncate" title={currentTrack.name}>
                {currentTrack.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {transcript && !isEditing && (
              <>
                <button
                  onClick={() => setViewMode(viewMode === 'synced' ? 'text' : 'synced')}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition flex items-center gap-1"
                  title="切換逐句對照 / 純文字檢視"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{viewMode === 'synced' ? '純文字模式' : '逐句對照'}</span>
                </button>

                <button
                  onClick={handleCopyText}
                  className="p-1.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
                  title="複製全部文字"
                >
                  {isCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>

                <button
                  onClick={handleDownloadTxt}
                  className="p-1.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
                  title="下載為 .txt 檔案"
                >
                  <Download className="w-4 h-4" />
                </button>

                <button
                  onClick={handleStartEditing}
                  className="p-1.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
                  title="手動編輯或貼上課本文字"
                >
                  <Edit3 className="w-4 h-4" />
                </button>

                <button
                  onClick={handleStartTranscribe}
                  disabled={!!job}
                  className="p-1.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition disabled:opacity-50"
                  title="重新使用 Whisper 辨識"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Error Banner */}
          {error && (
            <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs p-3.5 rounded-2xl flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold">辨識提示</div>
                <div className="mt-0.5">{error}</div>
              </div>
            </div>
          )}

          {/* Transcribing Progress State */}
          {isTranscribing && (
            <div className="py-12 px-4 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-[#E0F8C7] border border-[#BFE0A3] flex items-center justify-center text-[#36415A] shadow-md animate-pulse">
                <FileText className="w-8 h-8" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h4 className="text-base font-bold text-slate-900">
                  {job?.progress?.message || '正在辨識音檔...'}
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  辨識在你的瀏覽器裡進行，音檔不會上傳到任何 AI 伺服器。時間會隨音檔長度增加，請保持網頁開啟（可以先關閉這個視窗）。
                </p>
              </div>

              {job?.progress?.percent !== undefined && (
                <div className="w-full max-w-xs space-y-1.5">
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-[#36415A] transition-all duration-300"
                      style={{ width: `${job.progress.percent}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono text-right">
                    {job.progress.percent}%
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleCancelTranscribe}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 active:scale-95 transition"
              >
                取消辨識
              </button>
            </div>
          )}

          {/* Manual Editing Mode */}
          {!isTranscribing && isEditing && (
            <div className="space-y-4 h-full flex flex-col">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-700">編輯或貼上文字內容：</div>
                <div className="text-xs text-slate-400 text-right">
                  一行是一個段落。行數不變時保留原本的時間；行數改變時，會依字數大略重新分配時間。
                </div>
              </div>
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="在此貼上課本對應的聽力文字或對話內容..."
                className="flex-1 w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm text-slate-800 font-sans focus:outline-none focus:border-[#36415A] focus:bg-white resize-none leading-relaxed"
                rows={12}
              />
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveManualEdit}
                  disabled={!manualText.trim()}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-[#36415A] text-white hover:bg-[#2b3447] transition shadow-xs disabled:opacity-50"
                >
                  儲存音檔文字
                </button>
              </div>
            </div>
          )}

          {/* Initial Empty State (No transcript yet) */}
          {!isTranscribing && !isEditing && !transcript && (
            <div className="py-10 px-4 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-[#E0F8C7] border border-[#BFE0A3] flex items-center justify-center text-[#36415A] shadow-sm">
                <FileText className="w-8 h-8" />
              </div>
              <div className="space-y-1.5 max-w-md">
                <h4 className="text-base font-bold text-slate-900">目前音檔尚未轉錄文字</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  點擊下方按鈕辨識此音檔的內容，點擊任一句就能跳到該處播放。
                </p>
              </div>

              {isBusyWithOtherTrack && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  另一首音檔正在辨識中，完成後才能辨識這一首。
                </div>
              )}

              <div className="pt-3 flex flex-col sm:flex-row items-center gap-2.5 w-full max-w-sm">
                <button
                  onClick={handleStartTranscribe}
                  disabled={isBusyWithOtherTrack}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-xs font-semibold bg-[#36415A] hover:bg-[#2b3447] text-white shadow-md active:scale-95 transition disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4 text-[#E0F8C7]" />
                  <span>瀏覽器 Whisper 多語言自動偵測</span>
                </button>

                <button
                  onClick={handleStartPasting}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-3 rounded-2xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 active:scale-95 transition"
                >
                  <Edit3 className="w-4 h-4 text-slate-500" />
                  <span>手動貼上文字</span>
                </button>
              </div>

              <div className="pt-3 text-[11px] text-slate-400">
                • 辨識結果可能有錯字，可用編輯按鈕修正，或貼上課本原文。首次使用需要下載語音辨識模型，建議在 Wi-Fi 下進行。
              </div>
            </div>
          )}

          {/* Transcript Display */}
          {!isTranscribing && !isEditing && transcript && (
            <div className="space-y-4">
              {/* Search Bar within Transcript */}
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="搜尋文字內容..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent outline-none text-slate-800 placeholder:text-slate-400"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* View Mode: Synced Subtitles */}
              {viewMode === 'synced' ? (
                <div className="space-y-2">
                  {filteredSegments.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">找不到符合搜尋的文字</div>
                  ) : (
                    filteredSegments.map((segment) => {
                      const isActive = segment.id === activeId;

                      return (
                        <div
                          key={segment.id}
                          ref={isActive ? activeSegmentRef : null}
                          onClick={() => onSeek(segment.start)}
                          className={`p-3 rounded-2xl cursor-pointer transition-all flex items-start gap-3 select-none ${
                            isActive
                              ? 'bg-[#E0F8C7] border border-[#BFE0A3] text-[#36415A] font-bold shadow-xs scale-[1.01]'
                              : 'bg-white hover:bg-slate-50 border border-slate-100 text-slate-700'
                          }`}
                        >
                          {/* Timestamp Pill */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSeek(segment.start);
                            }}
                            className={`shrink-0 inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-lg transition ${
                              isActive
                                ? 'bg-[#36415A] text-[#E0F8C7]'
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                            title="跳轉至此時間點播放"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span>{formatTime(segment.start)}</span>
                          </button>

                          {/* Segment Text */}
                          <div className="flex-1 text-sm leading-relaxed">{segment.text}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                /* View Mode: Plain Text */
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap select-text font-sans">
                  {transcript.fullText}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500">
          <span>點擊任意句子或時間標記即可直接跳轉播放</span>
          <span>{transcript ? `共 ${transcript.segments.length} 個語句段落` : 'Whisper 多語言自動偵測'}</span>
        </div>
      </div>
    </div>
  );
};