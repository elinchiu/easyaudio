import React, { useState, useEffect, useRef } from 'react';
import { LyricSegment, AudioTrack } from '../types/track';
import { 
  Sparkles, 
  X, 
  Copy, 
  Download, 
  Edit3, 
  Check, 
  RefreshCw, 
  Play, 
  Languages, 
  UploadCloud, 
  FileText,
  Volume2,
  ChevronDown
} from 'lucide-react';
import { exportLrc, parseLrc, saveStoredLyrics, transcribeAudioWithAi } from '../lib/lyricsService';

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
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(true);
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
    // Find the segment where currentTime is between startTime and endTime
    for (let i = 0; i < lyrics.length; i++) {
      const seg = lyrics[i];
      if (currentTime >= seg.startTime && currentTime < seg.endTime) {
        return i;
      }
    }
    // If between segments, pick the last segment that started before currentTime
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
    // Resume auto-scroll after 4 seconds of inactivity
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

  // AI Generate Lyrics
  const handleGenerateAiLyrics = async () => {
    if (!currentTrack) return;
    setIsGenerating(true);
    setGenerationError(null);

    try {
      const blob = await getAudioBlob();
      if (!blob) {
        throw new Error('無法取得目前播放音檔的數據，請確認音檔已載入。');
      }

      const segments = await transcribeAudioWithAi(
        blob,
        currentTrack.name,
        currentTrack.mimeType || 'audio/mp3'
      );

      if (segments && segments.length > 0) {
        saveStoredLyrics(currentTrack.id, segments);
        onUpdateLyrics(segments);
        setUserScrolled(false);
      } else {
        throw new Error('AI 未能從該音檔辨識出有效歌詞，請檢查音檔內容。');
      }
    } catch (err: any) {
      console.error('Failed to generate lyrics with AI:', err);
      setGenerationError(err.message || '產生歌詞失敗，請確認網路連線或伺服器設定。');
    } finally {
      setIsGenerating(false);
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
    const text = lyrics.map((l) => `${l.text}${l.translation ? ` (${l.translation})` : ''}`).join('\n');
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

  const hasTranslations = lyrics?.some((s) => !!s.translation);

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
                  即時歌詞與字幕
                </h3>
                {lyrics && lyrics.length > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#E0F8C7] text-[#36415A]">
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
            {hasTranslations && (
              <button
                onClick={() => setShowTranslation(!showTranslation)}
                className={`p-2 rounded-xl text-xs font-semibold transition border ${
                  showTranslation
                    ? 'bg-[#E0F8C7] text-[#36415A] border-transparent'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}
                title="切換繁體中文翻譯"
              >
                <Languages className="w-4 h-4" />
              </button>
            )}

            {lyrics && lyrics.length > 0 && (
              <>
                <button
                  onClick={handleCopy}
                  className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition"
                  title="複製歌詞全文"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
                <button
                  onClick={handleDownloadLrc}
                  className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition"
                  title="匯出 .LRC 歌詞檔"
                >
                  <Download className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              onClick={handleOpenEdit}
              className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition"
              title="編輯或手動貼上歌詞"
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
          {isGenerating ? (
            <div className="h-full flex flex-col items-center justify-center py-16 space-y-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-[#E0F8C7] flex items-center justify-center text-[#36415A] animate-pulse">
                  <Sparkles className="w-8 h-8 animate-spin" style={{ animationDuration: '3s' }} />
                </div>
                <div className="absolute -inset-2 rounded-full border-2 border-[#36415A]/20 border-t-[#36415A] animate-spin" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-[#36415A]">AI 正在聆聽並生成時間軸歌詞...</h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  正在精確解析音訊語音，將每句句子配對毫秒級時間軸，請稍候片刻
                </p>
              </div>
            </div>
          ) : isEditing ? (
            <div className="h-full flex flex-col text-left space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-600 font-semibold">
                <span>編輯或貼上 LRC / 歌詞文字：</span>
                <span className="text-[11px] text-slate-400 font-normal">支援 [00:12.30]歌詞 格式或純文字</span>
              </div>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                placeholder="[00:00.00]第一句歌詞&#10;[00:05.50]第二句歌詞&#10;..."
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
                  儲存並套用歌詞
                </button>
              </div>
            </div>
          ) : !lyrics || lyrics.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-12 space-y-4 max-w-md mx-auto">
              <div className="w-16 h-16 rounded-3xl bg-[#E0F8C7] flex items-center justify-center text-[#36415A] shadow-sm">
                <Sparkles className="w-8 h-8 text-[#36415A]" />
              </div>
              <div className="space-y-1">
                <h4 className="text-lg font-bold text-[#36415A]">目前音檔尚無即時歌詞</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  點擊下方按鈕，由 Gemini AI 自動辨識此音檔的語音或歌詞，產生像歌曲一樣逐句高亮滾動的即時字幕！
                </p>
              </div>

              {generationError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 text-left w-full">
                  <div className="font-semibold">產生失敗</div>
                  <div className="mt-0.5">{generationError}</div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2.5 pt-2 w-full justify-center">
                <button
                  onClick={handleGenerateAiLyrics}
                  disabled={!currentTrack}
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold bg-[#36415A] hover:bg-[#2b3447] text-white shadow-md active:scale-95 transition disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4 text-[#E0F8C7]" />
                  <span>AI 一鍵生成即時歌詞</span>
                </button>

                <button
                  onClick={handleOpenEdit}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>手動貼上歌詞</span>
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

                    {/* Original lyric text */}
                    <div
                      className={`tracking-wide leading-relaxed transition-all ${
                        isActive ? 'text-base sm:text-lg font-bold text-[#36415A]' : 'text-sm sm:text-base'
                      }`}
                    >
                      {segment.text}
                    </div>

                    {/* Translation text */}
                    {showTranslation && segment.translation && (
                      <div
                        className={`text-xs mt-1 transition-all ${
                          isActive ? 'text-[#36415A]/80 font-medium' : 'text-slate-400'
                        }`}
                      >
                        {segment.translation}
                      </div>
                    )}
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
              <span>回到目前播放歌詞</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Bottom Lyrics Footer Controls */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-white/95 flex items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            {lyrics && lyrics.length > 0 && (
              <button
                onClick={handleGenerateAiLyrics}
                disabled={isGenerating || !currentTrack}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition disabled:opacity-50"
                title="重新使用 AI 辨識並生成"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                <span>重新生成</span>
              </button>
            )}
            <span className="text-slate-400 font-mono text-[11px]">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="text-[11px] text-slate-400">
            點擊任一句歌詞即可立即跳轉該時間點播放
          </div>
        </div>
      </div>
    </div>
  );
};
