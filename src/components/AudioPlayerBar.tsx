import React, { useState, useEffect } from 'react';
import { AudioTrack, RepeatMode, ABRepeat } from '../types/track';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Gauge,
  ChevronUp,
  ChevronDown,
  Disc,
  FileText,
} from 'lucide-react';

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5];

// 底部播放列 / 全螢幕畫面的按鈕共用樣式
const barBtn =
  'p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 active:scale-95 transition flex items-center justify-center';
const drawerBtn =
  'p-3 text-slate-600 hover:text-slate-900 rounded-full bg-slate-100 active:scale-95 flex items-center justify-center';

const formatTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// 圓形箭頭圖示，秒數文字放在圓圈正中間
const SkipIcon: React.FC<{
  direction: 'back' | 'forward';
  seconds?: number;
  sizeClass?: string;
  textClass?: string;
}> = ({
  direction,
  seconds = 3,
  sizeClass = 'w-6 h-6 sm:w-7 sm:h-7',
  textClass = 'text-[8px] sm:text-[9px]',
}) => {
  const Icon = direction === 'back' ? RotateCcw : RotateCw;
  return (
    <span className={`relative inline-flex items-center justify-center ${sizeClass}`}>
      <Icon className="w-full h-full" strokeWidth={1.5} />
      <span
        className={`absolute inset-0 flex items-center justify-center font-bold leading-none text-indigo-600 pt-px ${textClass}`}
      >
        {seconds}s
      </span>
    </span>
  );
};

interface Props {
  currentTrack: AudioTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  repeatMode: RepeatMode;
  volume: number;
  isMuted: boolean;
  isLoading: boolean;
  audioError: string | null;
  abRepeat: ABRepeat;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (time: number) => void;
  onSkip: (seconds: number) => void;
  onChangePlaybackRate: (rate: number) => void;
  onSetRepeatMode: (mode: RepeatMode) => void;
  onChangeVolume: (volume: number) => void;
  onToggleMute: () => void;
  onSetPointA: () => void;
  onSetPointB: () => void;
  onClearAB: () => void;
  onAuthorizeGoogle?: () => void;
  onOpenTranscript?: () => void;
}

export const AudioPlayerBar: React.FC<Props> = ({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  repeatMode,
  volume,
  isMuted,
  isLoading,
  audioError,
  abRepeat,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onSkip,
  onChangePlaybackRate,
  onSetRepeatMode,
  onChangeVolume,
  onToggleMute,
  onSetPointA,
  onSetPointB,
  onClearAB,
  onAuthorizeGoogle,
  onOpenTranscript,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // 已移除循環按鈕：固定為「播完最後一首就停止」（normal）
  useEffect(() => {
    if (repeatMode !== 'normal') onSetRepeatMode('normal');
  }, [repeatMode, onSetRepeatMode]);

  if (!currentTrack) return null;

  // 時間點轉成進度條上的百分比位置
  const percentOf = (time: number | null) =>
    time !== null && duration > 0 ? (time / duration) * 100 : null;

  const progressPercent = percentOf(currentTime) ?? 0;
  const aPercent = percentOf(abRepeat.pointA);
  const bPercent = percentOf(abRepeat.pointB);
  const hasAB = abRepeat.pointA !== null || abRepeat.pointB !== null;

  const markers = [
    { label: 'A', percent: aPercent, time: abRepeat.pointA },
    { label: 'B', percent: bPercent, time: abRepeat.pointB },
  ];
  const abButtons = [
    { label: 'A', point: abRepeat.pointA, onClick: onSetPointA, title: '設定循環起點 A' },
    { label: 'B', point: abRepeat.pointB, onClick: onSetPointB, title: '設定循環終點 B' },
  ];

  return (
    <>
      {/* 底部播放列 */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-xl border-t border-slate-200 shadow-[0_-4px_25px_rgba(0,0,0,0.08)] transition-all">
        {/* 進度條（含 A-B 標記） */}
        <div className="relative w-full h-2 group cursor-pointer bg-slate-200">
          {aPercent !== null && bPercent !== null && (
            <div
              className="absolute top-0 bottom-0 bg-amber-400/40 border-x border-amber-500 z-10"
              style={{
                left: `${Math.min(aPercent, bPercent)}%`,
                width: `${Math.abs(bPercent - aPercent)}%`,
              }}
            />
          )}

          {markers.map(
            ({ label, percent, time }) =>
              percent !== null && (
                <div
                  key={label}
                  className="absolute top-[-3px] bottom-[-3px] w-1 bg-amber-500 z-20"
                  style={{ left: `${percent}%` }}
                  title={`${label} 點: ${formatTime(time!)}`}
                />
              )
          )}

          <div
            className="h-full bg-indigo-600 relative transition-all"
            style={{ width: `${progressPercent}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-indigo-700 shadow scale-0 group-hover:scale-100 transition-transform" />
          </div>

          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30"
          />
        </div>

        {/* 三欄 grid：中間的播放控制固定在正中央 */}
        <div className="max-w-7xl mx-auto px-4 py-2.5 sm:py-3 grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 safe-bottom text-slate-800">
          {/* 左：曲目資訊 */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 group relative overflow-hidden shadow-sm"
              title="展開詳細播放控制"
            >
              <Disc className={`w-5 h-5 ${isPlaying ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
              <div className="absolute inset-0 bg-indigo-600/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-indigo-700" />
                ) : (
                  <ChevronUp className="w-4 h-4 text-indigo-700" />
                )}
              </div>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="text-xs sm:text-sm font-bold text-slate-800 truncate cursor-pointer hover:text-indigo-600 transition-colors"
                  title={currentTrack.name}
                >
                  {currentTrack.name}
                </div>
                {onOpenTranscript && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTranscript();
                    }}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-[#E0F8C7] hover:bg-[#d4f2b3] text-[#36415A] border border-[#BFE0A3] transition active:scale-95 shadow-2xs"
                    title="開啟音檔文字（Whisper 德文語音辨識 / 字幕）"
                  >
                    <FileText className="w-3 h-3 text-[#36415A]" />
                    <span>Script</span>
                  </button>
                )}
              </div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>
          </div>

          {/* 中：主要播放控制 */}
          <div className="flex items-center justify-center gap-1 sm:gap-2.5">
            <button onClick={() => onSkip(-3)} className={barBtn} title="倒退 3 秒 (快捷鍵: ←)">
              <SkipIcon direction="back" />
            </button>

            <button onClick={onPrev} className={barBtn} title="上一首 (快捷鍵: Shift+P)">
              <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              onClick={onTogglePlay}
              disabled={isLoading}
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-md shadow-indigo-200 active:scale-95 transition disabled:opacity-50"
              title={isPlaying ? '暫停 (快捷鍵: 空白鍵)' : '播放 (快捷鍵: 空白鍵)'}
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>

            <button onClick={onNext} className={barBtn} title="下一首 (快捷鍵: Shift+N)">
              <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button onClick={() => onSkip(3)} className={barBtn} title="快進 3 秒 (快捷鍵: →)">
              <SkipIcon direction="forward" />
            </button>
          </div>

          {/* 右：學習輔助（速度、A-B 循環、睡眠計時、音量），僅桌面顯示 */}
          <div className="hidden md:flex items-center justify-end gap-2">
            
            {/* 速度：寬螢幕直接攤開 */}
            <div className="hidden xl:flex items-center gap-1">
              <span className="text-xs text-slate-500 mr-0.5">速度:</span>
              {SPEED_OPTIONS.map((rate) => (
                <button
                  key={rate}
                  onClick={() => onChangePlaybackRate(rate)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                    playbackRate === rate
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* 速度：較窄的桌面維持下拉選單（原本的程式碼，只多加 xl:hidden） */}
            <div className="relative xl:hidden">
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                title="速度調整"
              >
                <Gauge className="w-3.5 h-3.5 text-indigo-600" />
                <span>{playbackRate}x</span>
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-full mb-2 right-0 bg-white border border-slate-200 rounded-xl p-1.5 shadow-xl grid grid-cols-2 gap-1 w-32 z-50">
                  {SPEED_OPTIONS.map((rate) => (
                    <button
                      key={rate}
                      onClick={() => {
                        onChangePlaybackRate(rate);
                        setShowSpeedMenu(false);
                      }}
                      className={`text-xs py-1 px-2 rounded-lg text-center font-medium transition ${
                        playbackRate === rate ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* A-B 循環 */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200">
              {abButtons.map(({ label, point, onClick, title }) => (
                <button
                  key={label}
                  onClick={onClick}
                  title={title}
                  className={`text-[10px] font-bold px-2 py-1 rounded-lg transition ${
                    point !== null ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
              {hasAB && (
                <button
                  onClick={onClearAB}
                  className="text-[10px] px-1.5 py-1 text-slate-400 hover:text-rose-500 font-bold"
                  title="清除 A-B 循環"
                >
                  ✕
                </button>
              )}
            </div>

            {/* 音量 */}
            <div className="flex items-center gap-1.5 ml-1">
              <button
                onClick={onToggleMute}
                className="text-slate-500 hover:text-slate-800 p-1"
                title={isMuted ? '取消靜音' : '靜音'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-rose-500" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => onChangeVolume(parseFloat(e.target.value))}
                className="w-16 h-1.5 bg-slate-200 rounded-lg accent-indigo-600 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* 播放錯誤提示 */}
        {audioError && (
          <div className="bg-rose-50 text-rose-800 text-xs py-2 px-4 border-t border-rose-200 font-medium flex items-center justify-between gap-3 flex-wrap">
            <span>{audioError}</span>
            {onAuthorizeGoogle && (
              <button
                onClick={onAuthorizeGoogle}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-1 rounded-lg text-xs transition shadow-xs shrink-0"
              >
                點此授權 Google 讀取
              </button>
            )}
          </div>
        )}
      </div>

      {/* 全螢幕展開畫面（手機） */}
      {isExpanded && (
        <div className="fixed inset-0 z-50 bg-white/98 backdrop-blur-2xl flex flex-col justify-between p-6 animate-in slide-in-from-bottom duration-200 text-slate-800">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setIsExpanded(false)}
              className="p-2 rounded-xl bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>

          {/* 曲目資訊 */}
          <div className="flex flex-col items-center justify-center my-auto text-center px-4">
            <div className="w-48 h-48 rounded-3xl bg-indigo-50 border border-indigo-100 flex flex-col items-center justify-center shadow-lg text-indigo-600 p-6 relative">
              <Disc className={`w-24 h-24 ${isPlaying ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
            </div>
            <h2 className="mt-6 text-lg sm:text-xl font-bold text-slate-800 max-w-md break-all leading-relaxed">
              {currentTrack.name}
            </h2>
            {onOpenTranscript && (
              <button
                type="button"
                onClick={() => {
                  setIsExpanded(false);
                  onOpenTranscript();
                }}
                className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[#E0F8C7] hover:bg-[#d4f2b3] text-[#36415A] border border-[#BFE0A3] transition active:scale-95 shadow-xs"
              >
                <FileText className="w-3.5 h-3.5 text-[#36415A]" />
                <span>Script</span>
              </button>
            )}
          </div>

          <div className="space-y-4 max-w-lg mx-auto w-full pb-6">
            {/* 進度 */}
            <div>
              <div className="relative w-full h-2 rounded-full bg-slate-200 cursor-pointer overflow-hidden mb-2">
                <div className="h-full bg-indigo-600" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="flex justify-between text-xs text-slate-500 font-mono">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* A-B 跟讀循環 */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex items-center justify-between">
              <div className="text-xs text-slate-700">
                <div className="font-bold text-slate-800">A-B 區間跟讀循環</div>
                <div className="text-[11px] text-slate-500">
                  {abButtons
                    .map(({ label, point }) =>
                      point !== null ? `${label}: ${formatTime(point)}` : `尚未設 ${label} 點`
                    )
                    .join(' · ')}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {abButtons.map(({ label, point, onClick }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                      point !== null ? 'bg-amber-500 text-white' : 'bg-white border border-slate-200 text-slate-700'
                    }`}
                  >
                    設 {label} 點
                  </button>
                ))}
                {hasAB && (
                  <button
                    onClick={onClearAB}
                    className="p-1.5 text-xs text-slate-400 hover:text-rose-500 font-bold"
                  >
                    清除
                  </button>
                )}
              </div>
            </div>

            {/* 速度 */}
            <div className="flex items-center justify-center gap-1.5 text-xs text-slate-600 px-1">
              <span className="text-slate-500">速度:</span>
              {SPEED_OPTIONS.map((rate) => (
                <button
                  key={rate}
                  onClick={() => onChangePlaybackRate(rate)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                    playbackRate === rate ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* 播放控制 */}
            <div className="flex items-center justify-center gap-4 pt-1">
              <button onClick={() => onSkip(-3)} className={drawerBtn} title="倒退 3 秒 (快捷鍵: ←)">
                <SkipIcon direction="back" sizeClass="w-7 h-7" textClass="text-[10px]" />
              </button>
              <button onClick={onPrev} className={drawerBtn}>
                <SkipBack className="w-6 h-6" />
              </button>
              <button
                onClick={onTogglePlay}
                className="w-16 h-16 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-200 active:scale-95"
              >
                {isPlaying ? (
                  <Pause className="w-8 h-8 fill-current" />
                ) : (
                  <Play className="w-8 h-8 fill-current ml-1" />
                )}
              </button>
              <button onClick={onNext} className={drawerBtn}>
                <SkipForward className="w-6 h-6" />
              </button>
              <button onClick={() => onSkip(3)} className={drawerBtn} title="快進 3 秒 (快捷鍵: →)">
                <SkipIcon direction="forward" sizeClass="w-7 h-7" textClass="text-[10px]" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
