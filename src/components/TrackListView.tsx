import React, { useState, useMemo } from 'react';
import { AudioTrack } from '../types/track';
import { Play, Pause, Search, X, Music } from 'lucide-react';

interface Props {
  tracks: AudioTrack[];
  /** 已知的時長（秒），key 是 track id */
  durations?: Record<string, number>;
  currentTrackId?: string;
  isPlaying: boolean;
  onPlayTrack: (track: AudioTrack) => void;
  onTogglePlay: () => void;
  onAuthorize?: () => void;
  hasAccessToken?: boolean;
}

// 秒數轉 mm:ss，未知時顯示 --:--
const formatDuration = (seconds?: number): string => {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const TrackListView: React.FC<Props> = ({
  tracks,
  durations = {},
  currentTrackId,
  isPlaying,
  onPlayTrack,
  onTogglePlay,
  onAuthorize,
  hasAccessToken,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const hasTracks = tracks.length > 0;

  // 依搜尋字串過濾
  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter(
      (t) => t.name.toLowerCase().includes(q) || t.cleanName?.toLowerCase().includes(q)
    );
  }, [tracks, searchQuery]);

  return (
    <div className="space-y-3.5">
      {/* 搜尋列 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
        <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-800 focus-within:border-indigo-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="搜尋..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-sm focus:outline-none placeholder:text-slate-400 text-slate-800 font-medium"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              title="清除"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 數量 */}
      <div className="px-1 text-xs text-slate-500 font-medium">
        {searchQuery ? `找到 ${filteredTracks.length} 筆符合` : `共 ${filteredTracks.length} 首音檔`}
      </div>

      {filteredTracks.length === 0 ? (
        /* 沒有音檔，或搜尋不到 */
        <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-10 text-center shadow-sm space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mx-auto">
            <Music className="w-7 h-7" />
          </div>
          <div>
            <h4 className="text-base font-bold text-slate-800">
              {hasTracks ? '找不到符合條件的音檔' : '尚未載入音檔'}
            </h4>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
              {hasTracks
                ? `沒有包含「${searchQuery}」的檔案`
                : '請確認資料夾已設為「知道連結的任何人」可檢視，然後在上方貼上資料夾連結並按「匯入」，或按「重新整理」。若是私人資料夾，可以登入 Google 後讀取。'}
            </p>
          </div>

          {!hasTracks && onAuthorize && !hasAccessToken && (
            <button
              onClick={onAuthorize}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 active:scale-95 transition"
            >
              登入 Google 讀取（私人資料夾）
            </button>
          )}

          {hasTracks && (
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition"
            >
              清除搜尋
            </button>
          )}
        </div>
      ) : (
        /* 音檔列表 */
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden shadow-sm">
          {filteredTracks.map((track) => {
            const isCurrent = track.id === currentTrackId;
            const isCurrentPlaying = isCurrent && isPlaying;

            return (
              // 整列可點：目前這首就切換播放/暫停，否則播放這首（內部的播放鈕點擊會一起冒泡到這裡）
              <div
                key={track.id}
                onClick={() => (isCurrent ? onTogglePlay() : onPlayTrack(track))}
                className={`px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer group transition-colors select-none border-l-4 ${
                  isCurrent
                    ? 'bg-indigo-50/80 hover:bg-indigo-50 border-l-indigo-600'
                    : 'hover:bg-slate-50/90 border-l-transparent'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <button
                    type="button"
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all shadow-sm ${
                      isCurrent
                        ? 'bg-indigo-600 text-white shadow-indigo-200'
                        : 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white'
                    } ${isCurrentPlaying ? 'scale-105' : ''}`}
                    title={isCurrentPlaying ? '暫停' : '播放音檔'}
                  >
                    {isCurrentPlaying ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>

                  <div
                    className={`min-w-0 flex-1 text-sm font-semibold break-all leading-relaxed transition-colors ${
                      isCurrent ? 'text-indigo-950 font-bold' : 'text-slate-800'
                    }`}
                    title={track.name}
                  >
                    {track.name}
                  </div>
                </div>

                <div className="text-xs text-slate-400 font-mono shrink-0 tabular-nums">
                  {formatDuration(track.duration || durations[track.id])}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};