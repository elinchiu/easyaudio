import React, { useState, useEffect, useRef } from 'react';
import { LyricSegment, AudioTrack } from '../types/track';
import { 
  Mic, 
  X, 
  Copy, 
  Download, 
  Edit3, 
  Check, 
  RefreshCw, 
  Play, 
  FileText,
  ChevronDown,
  Globe
} from 'lucide-react';
import { exportLrc, parseLrc, saveStoredLyrics } from '../lib/lyricsService';
import { transcribeWithBrowserWhisper, WhisperProgress } from '../lib/whisperService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: AudioTrack | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  lyrics: LyricSegment[] | null;
  onUpdateLyrics: (segments: LyricSegment[]) => void;
  getAudioBlob: () => Promise<Blob | null>;
}

export const SyncedLyricsView: React.FC<Props> = ({
  isOpen,
  onClose,
  currentTrack,
  currentTime,
  duration,
  isPlaying,
  onSeek,
  onTogglePlay,
  lyrics,
  onUpdateLyrics,
  getAudioBlob,
}) => {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progressInfo, setProgressInfo] = useState<WhisperProgress | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('german');
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [copied, setCopied] = useState(false);
  const [userScrolled, setUserScrolled] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Find active line index
  const activeIndex = React.useMemo(() => {
    if (!lyrics || lyrics.length === 0) return -1;
    for (let i = 0; i < lyrics.length; i++) {
      const seg = lyrics[i];
      if (currentTime >= seg.startTime && currentTime < seg.endTime) {
        return i;
      }
    }
    let lastStarted = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].startTime) {
        lastStarted = i;
      } else {
        break;
      }
    }
    return lastStarted;
  }, [lyrics, currentTime]);

  // Smooth auto-scroll to active line
  useEffect(() => {
    if (userScrolled || activeIndex === -1 || !activeLineRef.current) return;

    activeLineRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [activeIndex, userScrolled]);

  // Handle manual scroll to pause auto-scroll briefly
  const handleScroll = () => {
    setUserScrolled(true);
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }
    userScrollTimeoutRef.current = setTimeout(() => {
      setUserScrolled(false);
    }, 4000);
  };

  // Format time mm:ss
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // In-browser Whisper Transcription (German default, no cloud AI)
  const handleTranscribeWithWhisper = async () => {
    if (!currentTrack) return;
    setIsTranscribing(true);
    setTranscriptionError(null);
    setProgressInfo({
      status: 'init',
      message: '正在準備音訊檔案...',
      percent: 5,
    });

    try {
      const blob = await getAudioBlob();
      if (!blob) {
        throw new Error('無法取得目前播放音檔的數據，請確認音檔已載入。');
      }

      const segments = await transcribeWithBrowserWhisper(blob, {
        language: selectedLanguage,
        onProgress: (progress) => {
          setProgressInfo(progress);
        },
      });

      if (segments && segments.length > 0) {
        saveStoredLyrics(currentTrack.id, segments);
        onUpdateLyrics(segments);
        setUserScrolled(false);
      } else {
        throw new Error('Whisper 未能從該音檔辨識出有效文字，請確認音檔是否有清楚語音。');
      }
    } catch (err: any) {
      console.error('Whisper in-browser transcription failed:', err);
      setTranscriptionError(err.message || 'Whisper 辨識失敗，請稍後重試。');
    } finally {
      setIsTranscribing(false);
      setProgressInfo(null);
    }
  };

  // Open editor with current LRC text
  const handleOpenEdit = () => {
    if (lyrics && lyrics.length > 0) {
      setEditText(exportLrc(lyrics, currentTrack?.name));
    } else {
      setEditText('');
    }
    setIsEditing(true);
  };

  // Save edited LRC text
  const handleSaveEdit = () => {
    if (!currentTrack) return;
    const segments = parseLrc(editText, duration || 180);
    saveStoredLyrics(currentTrack.id, segments);
    onUpdateLyrics(segments);
    setIsEditing(false);
    setUserScrolled(false);
  };

  // Copy lyrics
  const handleCopy = () => {
    if (!lyrics) return;
    const text = lyrics.map((l) => l.text).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download .LRC file
  const handleDownloadLrc = () => {
    if (!lyrics || !currentTrack) return;
    const lrcContent = exportLrc(lyrics, currentTrack.name);
    const blob = new Blob([lrcContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentTrack.name.replace(/\.[^/.]+$/, '')}.lrc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl h-[88vh] max-h-[750px] bg-white rounded-3xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 text-[#36415A]">
        {/* Top Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-white/95">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#E0F8C7] flex items-center justify-center text-[#36415A] shrink-0 font-bold">
              <FileText className="w-5 h-5 text-[#36415A]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#36415A] tracking-tight">
                  即時字幕與歌詞
                </h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#E0F8C7] text-[#36415A] border border-emerald-300">
                  Whisper 瀏覽器本機辨識
                </span>
                {lyrics && lyrics.length > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    {lyrics.length} 句
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 truncate max-w-sm mt-0.5" title={currentTrack?.name}>
                {currentTrack?.name || '未選取音檔'}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Language Selector */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <Globe className="w-3.5 h-3.5 text-slate-500 ml-1" />
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-700 outline-none pr-1 cursor-pointer"
                title="辨識語言"
                disabled={isTranscribing}
              >
                <option value="german">德文 (Deutsch)</option>
                <option value="english">英文 (English)</option>
                <option value="auto">自動偵測 (Auto)</option>
              </select>
            </div>

            {lyrics && lyrics.length > 0 && (
              <>
                <button
                  onClick={handleCopy}
                  className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition"
                  title="複製文字全文"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
                <button
                  onClick={handleDownloadLrc}
                  className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition"
                  title="匯出 .LRC 字幕檔"
                >
                  <Download className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              onClick={handleOpenEdit}
              className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition"
              title="編輯或手動貼上字幕"
            >
              <Edit3 className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              title="關閉"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Lyrics Content Area */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 py-8 space-y-4 text-center select-none relative scroll-smooth bg-gradient-to-b from-white via-[#F3FCEA]/30 to-white"
        >
          {isTranscribing ? (
            <div className="h-full flex flex-col items-center justify-center py-16 space-y-4 max-w-md mx-auto">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-[#E0F8C7] flex items-center justify-center text-[#36415A] shadow-md animate-pulse">
                  <Mic className="w-8 h-8 animate-bounce text-[#36415A]" />
                </div>
              </div>

              <div className="space-y-1 text-center w-full">
                <h4 className="text-base font-bold text-[#36415A]">
                  {progressInfo?.message || 'Whisper 正在瀏覽器本機辨識德文音檔...'}
                </h4>
                <p className="text-xs text-slate-500">
                  全程在您的瀏覽器本機內執行 Whisper，不傳送音檔至外部伺服器
                </p>
              </div>

              {/* Progress Bar */}
              {progressInfo?.percent !== undefined && (
                <div className="w-full max-w-xs space-y-1">
                  <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[#36415A] h-full transition-all duration-300 rounded-full"
                      style={{ width: `${progressInfo.percent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                    <span>進度</span>
                    <span>{progressInfo.percent}%</span>
                  </div>
                </div>
              )}
            </div>
          ) : isEditing ? (
            <div className="h-full flex flex-col text-left space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-600 font-semibold">
                <span>編輯或貼上 LRC / 字幕文字：</span>
                <span className="text-[11px] text-slate-400 font-normal">支援 [00:12.30]歌詞 格式或純文字</span>
              </div>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                placeholder="[00:00.00]Guten Tag&#10;[00:04.20]Wie geht es Ihnen?&#10;..."
                className="w-full flex-1 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-mono text-[#36415A] outline-none focus:border-[#36415A] focus:bg-white resize-none leading-relaxed"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#36415A] text-white hover:bg-[#2b3447] shadow-sm"
                >
                  儲存並套用字幕
                </button>
              </div>
            </div>
          ) : !lyrics || lyrics.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-12 space-y-4 max-w-md mx-auto">
              <div className="w-16 h-16 rounded-3xl bg-[#E0F8C7] flex items-center justify-center text-[#36415A] shadow-sm">
                <Mic className="w-8 h-8 text-[#36415A]" />
              </div>
              <div className="space-y-1">
                <h4 className="text-lg font-bold text-[#36415A]">目前音檔尚無即時文字</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  點擊下方按鈕，在瀏覽器本機內執行語言辨識，將音檔轉錄為即時字幕，無須使用雲端 AI，兼顧隱私與穩定！
                </p>
              </div>

              {transcriptionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 text-left w-full">
                  <div className="font-semibold">辨識失敗</div>
                  <div className="mt-0.5">{transcriptionError}</div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2.5 pt-2 w-full justify-center">
                <button
                  onClick={handleTranscribeWithWhisper}
                  disabled={!currentTrack}
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold bg-[#36415A] hover:bg-[#2b3447] text-white shadow-md active:scale-95 transition disabled:opacity-50"
                >
                  <Mic className="w-4 h-4 text-[#E0F8C7]" />
                  <span>Whisper 德文語音轉錄</span>
                </button>

                <button
                  onClick={handleOpenEdit}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>手動貼上文字</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="py-12 space-y-4">
              {lyrics.map((segment, idx) => {
                const isActive = idx === activeIndex;
                const isPast = idx < activeIndex;

                return (
                  <div
                    key={idx}
                    ref={isActive ? activeLineRef : null}
                    onClick={() => {
                      onSeek(segment.startTime);
                      if (!isPlaying) onTogglePlay();
                    }}
                    className={`group cursor-pointer rounded-2xl px-4 py-3 transition-all duration-300 max-w-xl mx-auto flex flex-col items-center justify-center ${
                      isActive
                        ? 'bg-[#E0F8C7] text-[#36415A] shadow-md scale-105 font-bold'
                        : isPast
                        ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-50/80 font-normal'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 font-normal'
                    }`}
                  >
                    {/* Timestamp & Play Icon indicator on hover / active */}
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="w-2.5 h-2.5 fill-current text-[#36415A]" />
                      <span>{formatTime(segment.startTime)}</span>
                    </div>

                    {/* German text */}
                    <div
                      className={`tracking-wide leading-relaxed transition-all ${
                        isActive ? 'text-base sm:text-lg font-bold text-[#36415A]' : 'text-sm sm:text-base'
                      }`}
                    >
                      {segment.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Floating Return to Current Lyric button if user manually scrolled away */}
        {userScrolled && activeIndex !== -1 && lyrics && lyrics.length > 0 && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
            <button
              onClick={() => {
                setUserScrolled(false);
                activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#36415A] text-white text-xs font-semibold shadow-lg hover:bg-[#2b3447] active:scale-95 transition"
            >
              <span>回到目前播放字幕</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Bottom Lyrics Footer Controls */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-white/95 flex items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            {lyrics && lyrics.length > 0 && (
              <button
                onClick={handleTranscribeWithWhisper}
                disabled={isTranscribing || !currentTrack}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition disabled:opacity-50"
                title="重新使用 Whisper 辨識"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTranscribing ? 'animate-spin' : ''}`} />
                <span>Whisper 重新轉錄</span>
              </button>
            )}
            <span className="text-slate-400 font-mono text-[11px]">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="text-[11px] text-slate-400">
            點擊任一句字幕即可立即跳轉該時間點播放
          </div>
        </div>
      </div>
    </div>
  );
};
