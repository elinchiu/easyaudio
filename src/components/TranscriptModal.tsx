import React, { useState, useEffect, useRef } from 'react';
import { AudioTrack } from '../types/track';
import { 
  TranscriptSegment, 
  TrackTranscript, 
  getCachedTranscript, 
  saveCachedTranscript, 
  transcribeAudioWithWhisper,
  TranscribeProgress
} from '../lib/whisper';
import { getTrackPlayableUrl } from '../lib/driveApi';
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
  Layers
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: AudioTrack | null;
  currentTime: number;
  onSeek: (time: number) => void;
  accessToken?: string | null;
}

export const TranscriptModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentTrack,
  currentTime,
  onSeek,
  accessToken,
}) => {
  const [transcript, setTranscript] = useState<TrackTranscript | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // View mode: 'synced' (逐句對照) or 'text' (純文字)
  const [viewMode, setViewMode] = useState<'synced' | 'text'>('synced');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  // Manual edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [manualText, setManualText] = useState('');

  // Auto-scroll ref
  const activeSegmentRef = useRef<HTMLDivElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  // Load cached transcript when track changes or modal opens
  useEffect(() => {
    if (!currentTrack || !isOpen) return;
    setError(null);
    setIsEditing(false);
    const cached = getCachedTranscript(currentTrack.id);
    setTranscript(cached);
    if (cached) {
      setManualText(cached.fullText);
    }
  }, [currentTrack?.id, isOpen]);

  // Auto-scroll to active segment if playing
  useEffect(() => {
    if (viewMode === 'synced' && activeSegmentRef.current && listContainerRef.current) {
      activeSegmentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [currentTime, viewMode]);

  if (!isOpen || !currentTrack) return null;

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Start Whisper transcription in browser
  const handleStartTranscribe = async () => {
    setIsTranscribing(true);
    setError(null);
    setProgress({
      stage: 'decoding',
      message: '正在讀取音訊檔...',
    });

    try {
      // 1. Get audio playable URL
      const streamUrl = await getTrackPlayableUrl(currentTrack, accessToken);
      
      // 2. Fetch the audio blob safely (only reading the response stream ONCE)
      const res = await fetch(streamUrl);
      if (!res.ok) {
        throw new Error(`無法下載音訊檔案 (HTTP ${res.status})，請確認檔案分享權限。`);
      }
      const audioBlob = await res.blob();

      // 3. Run Whisper
      const result = await transcribeAudioWithWhisper(
        audioBlob,
        currentTrack.id,
        currentTrack.name,
        'german',
        (p) => setProgress(p)
      );

      setTranscript(result);
      setManualText(result.fullText);
      setIsTranscribing(false);
      setProgress(null);
    } catch (err: any) {
      console.error('Whisper transcription failed:', err);
      setError(err?.message || '辨識失敗，請稍後再試。');
      setIsTranscribing(false);
      setProgress(null);
    }
  };

  // Save manual edit
  const handleSaveManualEdit = () => {
    if (!currentTrack) return;
    const lines = manualText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const segments: TranscriptSegment[] = lines.map((text, idx) => ({
      id: idx + 1,
      start: transcript?.segments[idx]?.start ?? idx * 5,
      end: transcript?.segments[idx]?.end ?? (idx + 1) * 5,
      text,
    }));

    const updated: TrackTranscript = {
      trackId: currentTrack.id,
      trackName: currentTrack.name,
      fullText: manualText.trim(),
      segments: segments.length > 0 ? segments : [{ id: 1, start: 0, end: 10, text: manualText.trim() }],
      language: 'german',
      createdAt: Date.now(),
    };

    saveCachedTranscript(updated);
    setTranscript(updated);
    setIsEditing(false);
  };

  // Copy text to clipboard
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

  // Download .txt file
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

  // Filtered segments based on search
  const filteredSegments = (transcript?.segments || []).filter((seg) => {
    if (!searchQuery.trim()) return true;
    return seg.text.toLowerCase().includes(searchQuery.trim().toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150">
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
                  Whisper 德文語音辨識
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
                  onClick={() => setIsEditing(true)}
                  className="p-1.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
                  title="手動編輯或貼上課本文字"
                >
                  <Edit3 className="w-4 h-4" />
                </button>

                <button
                  onClick={handleStartTranscribe}
                  disabled={isTranscribing}
                  className="p-1.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition disabled:opacity-50"
                  title="重新使用 Whisper 辨識"
                >
                  <RotateCcw className={`w-4 h-4 ${isTranscribing ? 'animate-spin' : ''}`} />
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
        <div className="flex-1 overflow-y-auto p-4 sm:p-6" ref={listContainerRef}>
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
                  {progress?.message || '正在使用 Whisper 辨識音檔...'}
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  完全在您的瀏覽器內由 Whisper 模型進行離線語音辨識，不使用外部 AI 伺服器，德文辨識精準度高。
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
            </div>
          )}

          {/* Manual Editing Mode */}
          {!isTranscribing && isEditing && (
            <div className="space-y-4 h-full flex flex-col">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-700">編輯或貼上文字內容：</div>
                <div className="text-xs text-slate-400">每一行將自動對應為一個對照段落</div>
              </div>
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="在此貼上課本對應的德文聽力文字或對話內容..."
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
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-[#36415A] text-white hover:bg-[#2b3447] transition shadow-xs"
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
                  點擊下方按鈕，直接在瀏覽器中使用 <b>Whisper 語音模型</b> 辨識此音檔的德文內容，辨識後可隨播放時間逐句高亮對照並點擊跳轉！
                </p>
              </div>

              <div className="pt-3 flex flex-col sm:flex-row items-center gap-2.5 w-full max-w-sm">
                <button
                  onClick={handleStartTranscribe}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-xs font-semibold bg-[#36415A] hover:bg-[#2b3447] text-white shadow-md active:scale-95 transition"
                >
                  <Sparkles className="w-4 h-4 text-[#E0F8C7]" />
                  <span>瀏覽器 Whisper 德文辨識</span>
                </button>

                <button
                  onClick={() => {
                    setManualText('');
                    setIsEditing(true);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-3 rounded-2xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 active:scale-95 transition"
                >
                  <Edit3 className="w-4 h-4 text-slate-500" />
                  <span>手動貼上文字</span>
                </button>
              </div>

              <div className="pt-3 text-[11px] text-slate-400">
                • 專為德文（German）與各長度聽力音檔設計，無外部 AI 伺服器依賴，安全保密
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
                      const isActive = currentTime >= segment.start && currentTime < segment.end;

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
          <span>{transcript ? `共 ${transcript.segments.length} 個語句段落` : 'Whisper 德文辨識'}</span>
        </div>
      </div>
    </div>
  );
};
