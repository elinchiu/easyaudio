import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AudioTrack } from '../types/track';
import { TrackTranscript } from '../lib/whisper';
import type { TranscriptionQueue } from '../hooks/useTranscriptionQueue';
import {
  FileText,
  X,
  Play,
  AlertCircle,
  Search,
  Sparkles,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: AudioTrack | null;
  currentTime: number;
  onSeek: (time: number) => void;
  /** 語音辨識佇列（由 App 最上層建立；面板關著時辨識也會在背景繼續） */
  queue: TranscriptionQueue;
  /** 桌面版面板寬度（px）。由 App 保管，這樣主畫面才能跟著讓出對應的空間 */
  width: number;
  onWidthChange: (width: number) => void;
  /** 拖曳開始／結束時通知 App（拖曳中 App 會暫時關掉 padding 動畫，才不會延遲） */
  onResizingChange?: (resizing: boolean) => void;
}

export const TRANSCRIPT_PANEL_DEFAULT_WIDTH = 420;
export const TRANSCRIPT_PANEL_MIN_WIDTH = 320;
const TRANSCRIPT_PANEL_MAX_WIDTH = 800;

/** 寬度限制在 320px ～ min(800px, 視窗寬度的 60%) 之間 */
export function clampTranscriptWidth(w: number): number {
  const max = Math.max(
    TRANSCRIPT_PANEL_MIN_WIDTH,
    Math.min(TRANSCRIPT_PANEL_MAX_WIDTH, window.innerWidth * 0.6)
  );
  return Math.round(Math.min(Math.max(w, TRANSCRIPT_PANEL_MIN_WIDTH), max));
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const TranscriptModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentTrack,
  currentTime,
  onSeek,
  queue,
  width,
  onWidthChange,
  onResizingChange,
}) => {
  const trackId = currentTrack?.id ?? null;

  const [transcript, setTranscript] = useState<TrackTranscript | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const activeSegmentRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // 元件被移除時，確保拖曳中設定的游標與選取樣式被還原
  useEffect(
    () => () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    },
    []
  );

  // ── 拖曳左邊緣調整寬度（只有桌面版有這條拖曳把手） ──
  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId); // 滑鼠移出把手也能繼續拖
    draggingRef.current = true;
    onResizingChange?.(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    // 面板貼在右邊，所以寬度 = 視窗寬度 - 滑鼠的 X 位置
    onWidthChange(clampTranscriptWidth(window.innerWidth - e.clientX));
  };

  const endResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    onResizingChange?.(false);
  };

  // 鍵盤也能調整：把手聚焦後按 ←（變寬）/ →（變窄），Home 重設
  const handleResizeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onWidthChange(clampTranscriptWidth(width + 24));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onWidthChange(clampTranscriptWidth(width - 24));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onWidthChange(TRANSCRIPT_PANEL_DEFAULT_WIDTH);
    }
  };

  // 面板開啟時，按 Escape 關閉；面板關閉或元件卸載時移除監聽
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 開啟面板、切歌、或任何一首辨識完成（queue.version 變動）時，重新讀取這首歌的文字
  useEffect(() => {
    if (!trackId || !isOpen) return;
    setTranscript(queue.getTranscript(trackId));
  }, [trackId, isOpen, queue.version, queue.getTranscript]);

  // 切歌時清空搜尋
  useEffect(() => {
    setSearchQuery('');
  }, [trackId]);

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
    if (!isOpen || activeId === null) return;
    activeSegmentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeId, isOpen]);

  if (!isOpen || !currentTrack) return null;

  // 這一首在佇列裡的狀態
  const status = queue.statusOf(currentTrack.id);
  const isTranscribing = status === 'running';
  const isQueued = status === 'queued';
  const error = queue.errors[currentTrack.id] ?? null;
  const progress = isTranscribing ? queue.progress : null;

  // 辨識這一首（手動辨識，或之前失敗後重試）
  const handleStartTranscribe = () => queue.transcribeOnly(currentTrack);
  // 取消這一首（辨識中會中止、等候中會移除）
  const handleCancelTranscribe = () => queue.cancelTrack(currentTrack.id);

  const filteredSegments = (transcript?.segments || []).filter((seg) => {
    if (!searchQuery.trim()) return true;
    return seg.text.toLowerCase().includes(searchQuery.trim().toLowerCase());
  });

  return (
    // 固定在畫面右側的面板（不是彈跳視窗，沒有遮罩，後面的畫面仍可操作）
    // bottom-24：留出底部播放器的高度，如果播放器高度不同，改這個數字
    // lg 以上寬度由 CSS 變數 --transcript-w 決定（App.tsx 設定，並同步把主畫面往左推）；
    // 使用者可以拖曳左邊緣調整。小螢幕則滿版蓋在上面
    <aside
      aria-label="音檔文字"
      className="fixed top-0 right-0 bottom-24 z-30 w-full lg:w-[var(--transcript-w)] bg-white border-l border-slate-200 shadow-xl flex flex-col text-slate-800"
    >
      {/* 拖曳把手：只在桌面版顯示，雙擊恢復預設寬度 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="調整文字面板寬度"
        aria-valuenow={width}
        aria-valuemin={TRANSCRIPT_PANEL_MIN_WIDTH}
        aria-valuemax={TRANSCRIPT_PANEL_MAX_WIDTH}
        tabIndex={0}
        title="拖曳調整寬度（雙擊恢復預設）"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onLostPointerCapture={endResize}
        onDoubleClick={() => onWidthChange(TRANSCRIPT_PANEL_DEFAULT_WIDTH)}
        onKeyDown={handleResizeKeyDown}
        className="group hidden lg:flex absolute top-0 bottom-0 -left-1.5 w-3 z-10 items-center justify-center cursor-col-resize touch-none outline-none"
      >
        <div className="h-full w-0.5 bg-transparent group-hover:bg-[#BFE0A3] group-focus-visible:bg-[#BFE0A3] group-active:bg-[#36415A] transition-colors" />
        <div className="absolute top-1/2 -translate-y-1/2 h-10 w-1.5 rounded-full bg-slate-300 group-hover:bg-[#36415A] group-active:bg-[#36415A] transition-colors" />
      </div>

      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 bg-white">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#E0F8C7] text-[#36415A] flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-slate-700 truncate" title={currentTrack.name}>
            {currentTrack.name}
          </p>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition shrink-0"
          title="關閉（Esc）"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
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
                {progress?.message || '正在辨識音檔...'}
              </h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                辨識在瀏覽器裡進行，音檔不會上傳到任何 AI 伺服器。辨識時間會隨音檔長度增加，請保持網頁開啟。
              </p>
            </div>

            {progress?.percent !== undefined && (
              <div className="w-full max-w-xs space-y-1.5">
                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-[#36415A] transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-400 font-mono text-right">
                  {progress.percent}%
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

        {/* Initial Empty State (No transcript yet) */}
        {!isTranscribing && !transcript && (
          <div className="py-10 px-2 flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-[#E0F8C7] border border-[#BFE0A3] flex items-center justify-center text-[#36415A] shadow-sm">
              <FileText className="w-8 h-8" />
            </div>
            <div className="space-y-1.5 max-w-md">
              <h4 className="text-base font-bold text-slate-900">
                {isQueued ? '準備辨識中' : '目前音檔尚未轉錄文字'}
              </h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                {isQueued
                  ? '即將開始辨識這一首。'
                  : '點擊下方按鈕辨識此音檔的內容。辨識完成後，點擊任一句就能跳到該處播放。'}
              </p>
            </div>

            <div className="pt-3 flex flex-col items-center gap-3 w-full max-w-sm">
              {isQueued ? (
                <button
                  type="button"
                  onClick={handleCancelTranscribe}
                  className="w-full px-5 py-3 rounded-2xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 active:scale-95 transition"
                >
                  取消
                </button>
              ) : (
                <button
                  onClick={handleStartTranscribe}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-xs font-semibold bg-[#36415A] hover:bg-[#2b3447] text-white shadow-md active:scale-95 transition"
                >
                  <Sparkles className="w-4 h-4 text-[#E0F8C7]" />
                  <span>{error ? '重新辨識' : '開始辨識'}</span>
                </button>
              )}
            </div>

            <div className="pt-3 text-[11px] text-slate-400">
              • 辨識結果可能有錯字。首次使用需要下載語音辨識模型，建議在 Wi-Fi 下進行。
            </div>
          </div>
        )}

        {/* Transcript Display */}
        {!isTranscribing && transcript && (
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

            {/* Synced Subtitles */}
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
          </div>
        )}
      </div>

      {/* Footer info：有文字之後才顯示 */}
      {transcript && !isTranscribing && (
        <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500">
          <span>點擊任意句子即可直接跳轉</span>
        </div>
      )}
    </aside>
  );
};