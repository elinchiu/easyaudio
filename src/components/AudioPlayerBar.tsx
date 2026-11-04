import React, { useState } from 'react';
import { AudioTrack, RepeatMode, ABRepeat } from '../types/track';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  RotateCcw, 
  RotateCw, 
  Repeat, 
  Repeat1, 
  Shuffle, 
  Volume2, 
  VolumeX, 
  Gauge, 
  Moon, 
  ChevronUp, 
  ChevronDown, 
  Disc,
} from 'lucide-react';

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
  sleepTimerMinutes: number | null;
  sleepTimerSecondsLeft: number | null;
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
  onOpenSleepTimer: () => void;
  onAuthorizeGoogle?: () => void;
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
  sleepTimerMinutes,
  sleepTimerSecondsLeft,
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
  onOpenSleepTimer,
  onAuthorizeGoogle,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  if (!currentTrack) {
    return null;
  }

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const aPercent = abRepeat.pointA !== null && duration > 0 ? (abRepeat.pointA / duration) * 100 : null;
  const bPercent = abRepeat.pointB !== null && duration > 0 ? (abRepeat.pointB / duration) * 100 : null;

  const cycleRepeatMode = () => {
    if (repeatMode === 'repeat-all') onSetRepeatMode('repeat-one');
    else if (repeatMode === 'repeat-one') onSetRepeatMode('shuffle');
    else if (repeatMode === 'shuffle') onSetRepeatMode('normal');
    else onSetRepeatMode('repeat-all');
  };

  const speedOptions = [0.5, 0.75, 0.85, 1.0, 1.25, 1.5, 1.75, 2.0];

  return (
    <>
      {/* Light Theme Bottom Player */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-xl border-t border-slate-200 shadow-[0_-4px_25px_rgba(0,0,0,0.08)] transition-all">
        {/* Progress Bar with A-B Marker */}
        <div className="relative w-full h-2 group cursor-pointer bg-slate-200">
          {/* A-B Highlight Zone */}
          {aPercent !== null && bPercent !== null && (
            <div
              className="absolute top-0 bottom-0 bg-amber-400/40 border-x border-amber-500 z-10"
              style={{
                left: `${Math.min(aPercent, bPercent)}%`,
                width: `${Math.abs(bPercent - aPercent)}%`,
              }}
            />
          )}

          {/* Point A Marker */}
          {aPercent !== null && (
            <div
              className="absolute top-[-3px] bottom-[-3px] w-1 bg-amber-500 z-20"
              style={{ left: `${aPercent}%` }}
              title={`A 點: ${formatTime(abRepeat.pointA!)}`}
            />
          )}
          {/* Point B Marker */}
          {bPercent !== null && (
            <div
              className="absolute top-[-3px] bottom-[-3px] w-1 bg-amber-500 z-20"
              style={{ left: `${bPercent}%` }}
              title={`B 點: ${formatTime(abRepeat.pointB!)}`}
            />
          )}

          {/* Current Progress */}
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

        {/* Player Bar Content */}
        <div className="max-w-7xl mx-auto px-4 py-2.5 sm:py-3 flex items-center justify-between gap-3 safe-bottom text-slate-800">
          {/* Left: Track Info */}
          <div className="flex items-center gap-3 min-w-0 flex-1 sm:max-w-md">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 group relative overflow-hidden shadow-sm"
              title="展開詳細播放控制"
            >
              <Disc className={`w-5 h-5 ${isPlaying ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
              <div className="absolute inset-0 bg-indigo-600/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {isExpanded ? <ChevronDown className="w-4 h-4 text-indigo-700" /> : <ChevronUp className="w-4 h-4 text-indigo-700" />}
              </div>
            </button>

            <div className="min-w-0 flex-1">
              <div
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-xs sm:text-sm font-bold text-slate-800 truncate cursor-pointer hover:text-indigo-600 transition-colors"
                title={currentTrack.name}
              >
                {currentTrack.name}
              </div>

              <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>
          </div>

          {/* Center: Main Playback Controls */}
          <div className="flex items-center gap-1 sm:gap-2.5 shrink-0">
            {/* Rewind 3s */}
            <button
              onClick={() => onSkip(-3)}
              className="p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 active:scale-95 transition relative flex items-center justify-center group"
              title="倒退 3 秒 (快捷鍵: ←)"
            >
              <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="absolute text-[8px] font-bold text-indigo-600 -bottom-0.5">3s</span>
            </button>

            {/* Prev Track */}
            <button
              onClick={onPrev}
              className="p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 active:scale-95 transition"
              title="上一首"
            >
              <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            {/* Play / Pause */}
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

            {/* Next Track */}
            <button
              onClick={onNext}
              className="p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 active:scale-95 transition"
              title="下一首"
            >
              <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            {/* Forward 3s */}
            <button
              onClick={() => onSkip(3)}
              className="p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 active:scale-95 transition relative flex items-center justify-center group"
              title="快進 3 秒 (快捷鍵: →)"
            >
              <RotateCw className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="absolute text-[8px] font-bold text-indigo-600 -bottom-0.5">3s</span>
            </button>
          </div>

          {/* Right: Study Helper Controls (Speed, A-B Loop, Sleep, Volume) */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {/* Speed Selector */}
            <div className="relative">
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                title="語速調整"
              >
                <Gauge className="w-3.5 h-3.5 text-indigo-600" />
                <span>{playbackRate}x</span>
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-full mb-2 right-0 bg-white border border-slate-200 rounded-xl p-1.5 shadow-xl grid grid-cols-2 gap-1 w-32 z-50">
                  {speedOptions.map((rate) => (
                    <button
                      key={rate}
                      onClick={() => {
                        onChangePlaybackRate(rate);
                        setShowSpeedMenu(false);
                      }}
                      className={`text-xs py-1 px-2 rounded-lg text-center font-medium transition ${
                        playbackRate === rate
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* A-B Loop buttons */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200">
              <button
                onClick={onSetPointA}
                className={`text-[10px] font-bold px-2 py-1 rounded-lg transition ${
                  abRepeat.pointA !== null
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="設定循環起點 A"
              >
                A
              </button>
              <button
                onClick={onSetPointB}
                className={`text-[10px] font-bold px-2 py-1 rounded-lg transition ${
                  abRepeat.pointB !== null
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="設定循環終點 B"
              >
                B
              </button>
              {(abRepeat.pointA !== null || abRepeat.pointB !== null) && (
                <button
                  onClick={onClearAB}
                  className="text-[10px] px-1.5 py-1 text-slate-400 hover:text-rose-500 font-bold"
                  title="清除 A-B 循環"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Repeat Mode */}
            <button
              onClick={cycleRepeatMode}
              className="p-2 text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition"
              title={`循環模式: ${repeatMode}`}
            >
              {repeatMode === 'repeat-one' ? (
                <Repeat1 className="w-4 h-4 text-indigo-600" />
              ) : repeatMode === 'shuffle' ? (
                <Shuffle className="w-4 h-4 text-indigo-600" />
              ) : repeatMode === 'repeat-all' ? (
                <Repeat className="w-4 h-4 text-indigo-600" />
              ) : (
                <Repeat className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {/* Sleep Timer */}
            <button
              onClick={onOpenSleepTimer}
              className={`p-2 rounded-xl hover:bg-slate-100 transition relative ${
                sleepTimerMinutes !== null ? 'text-indigo-600' : 'text-slate-600 hover:text-slate-900'
              }`}
              title="定時睡眠關閉"
            >
              <Moon className="w-4 h-4" />
              {sleepTimerSecondsLeft !== null && sleepTimerSecondsLeft > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
              )}
            </button>

            {/* Volume */}
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

        {/* Audio Error Banner */}
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

      {/* Full-screen Mobile Drawer (Light Theme) */}
      {isExpanded && (
        <div className="fixed inset-0 z-50 bg-white/98 backdrop-blur-2xl flex flex-col justify-between p-6 animate-in slide-in-from-bottom duration-200 text-slate-800">
          {/* Header */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setIsExpanded(false)}
              className="p-2 rounded-xl bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
            <div className="text-center font-bold text-slate-700 text-sm">
              聽力播放專注模式
            </div>
            <div className="w-9" />
          </div>

          {/* Central Track info */}
          <div className="flex flex-col items-center justify-center my-auto text-center px-4">
            <div className="w-48 h-48 rounded-3xl bg-indigo-50 border border-indigo-100 flex flex-col items-center justify-center shadow-lg text-indigo-600 p-6 relative">
              <Disc className={`w-24 h-24 ${isPlaying ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
            </div>

            <h2 className="mt-6 text-lg sm:text-xl font-bold text-slate-800 max-w-md break-all leading-relaxed">
              {currentTrack.name}
            </h2>
          </div>

          {/* Expanded Controls */}
          <div className="space-y-4 max-w-lg mx-auto w-full pb-6">
            {/* Progress */}
            <div>
              <div className="relative w-full h-2 rounded-full bg-slate-200 cursor-pointer overflow-hidden mb-2">
                <div
                  className="h-full bg-indigo-600"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500 font-mono">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* A-B Repeat Card for Shadowing */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex items-center justify-between">
              <div className="text-xs text-slate-700">
                <div className="font-bold text-slate-800">A-B 區間跟讀循環</div>
                <div className="text-[11px] text-slate-500">
                  {abRepeat.pointA !== null ? `A: ${formatTime(abRepeat.pointA)}` : '尚未設 A 點'}
                  {' · '}
                  {abRepeat.pointB !== null ? `B: ${formatTime(abRepeat.pointB)}` : '尚未設 B 點'}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onSetPointA}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    abRepeat.pointA !== null ? 'bg-amber-500 text-white' : 'bg-white border border-slate-200 text-slate-700'
                  }`}
                >
                  設 A 點
                </button>
                <button
                  onClick={onSetPointB}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    abRepeat.pointB !== null ? 'bg-amber-500 text-white' : 'bg-white border border-slate-200 text-slate-700'
                  }`}
                >
                  設 B 點
                </button>
                {(abRepeat.pointA !== null || abRepeat.pointB !== null) && (
                  <button
                    onClick={onClearAB}
                    className="p-1.5 text-xs text-slate-400 hover:text-rose-500 font-bold"
                  >
                    清除
                  </button>
                )}
              </div>
            </div>

            {/* Speed & Repeat row */}
            <div className="flex items-center justify-between text-xs text-slate-600 px-1">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">語速:</span>
                {[0.75, 1.0, 1.25, 1.5].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => onChangePlaybackRate(rate)}
                    className={`px-2 py-1 rounded-lg text-xs font-semibold ${
                      playbackRate === rate ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              <button
                onClick={cycleRepeatMode}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 text-xs font-medium text-slate-700"
              >
                <Repeat className="w-3.5 h-3.5 text-indigo-600" />
                <span className="capitalize">{repeatMode}</span>
              </button>
            </div>

            {/* Playback Controls Row */}
            <div className="flex items-center justify-center gap-4 pt-1">
              <button
                onClick={() => onSkip(-3)}
                className="p-3 text-slate-600 hover:text-slate-900 rounded-full bg-slate-100 active:scale-95 relative flex items-center justify-center"
                title="倒退 3 秒 (快捷鍵: ←)"
              >
                <RotateCcw className="w-6 h-6" />
                <span className="absolute text-[9px] font-bold text-indigo-600 bottom-1">3s</span>
              </button>
              <button
                onClick={onPrev}
                className="p-3 text-slate-600 hover:text-slate-900 rounded-full bg-slate-100 active:scale-95"
              >
                <SkipBack className="w-6 h-6" />
              </button>
              <button
                onClick={onTogglePlay}
                className="w-16 h-16 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-200 active:scale-95"
              >
                {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
              </button>
              <button
                onClick={onNext}
                className="p-3 text-slate-600 hover:text-slate-900 rounded-full bg-slate-100 active:scale-95"
              >
                <SkipForward className="w-6 h-6" />
              </button>
              <button
                onClick={() => onSkip(3)}
                className="p-3 text-slate-600 hover:text-slate-900 rounded-full bg-slate-100 active:scale-95 relative flex items-center justify-center"
                title="快進 3 秒 (快捷鍵: →)"
              >
                <RotateCw className="w-6 h-6" />
                <span className="absolute text-[9px] font-bold text-indigo-600 bottom-1">3s</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
