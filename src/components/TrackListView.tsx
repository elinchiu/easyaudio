import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AudioTrack } from '../types/track';
import { Play, Pause, Search, X, Music } from 'lucide-react';

interface Props {
  tracks: AudioTrack[];
  currentTrackId?: string;
  isPlaying: boolean;
  onPlayTrack: (track: AudioTrack) => void;
  onTogglePlay: () => void;
  onAuthorize?: () => void;
  hasAccessToken?: boolean;
  /** 取得音檔可播放網址，用來讀取時長；沒給的話會用 track.audioUrl */
  getAudioUrl?: (track: AudioTrack) => string | undefined;
}

const DURATION_CACHE_KEY = 'tb_track_durations';
const CONCURRENCY = 0;

const loadDurationCache = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem(DURATION_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
};

const readAudioDuration = (url: string): Promise<number | null> => {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    let done = false;

    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), 15000);

    audio.onloadedmetadata = () => {
      const d = audio.duration;
      finish(Number.isFinite(d) && d > 0 ? d : null);
    };
    audio.onerror = () => finish(null);
    audio.src = url;
  });
};

export const TrackListView: React.FC<Props> = ({
  tracks,
  currentTrackId,
  isPlaying,
  onPlayTrack,
  onTogglePlay,
  onAuthorize,
  hasAccessToken,
  getAudioUrl,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [durations, setDurations] = useState<Record<string, number>>(loadDurationCache);
  const durationsRef = useRef(durations);
  durationsRef.current = durations;
  const failedRef = useRef<Set<string>>(new Set());

  // 背景讀取每首音檔的時長
  useEffect(() => {
    let cancelled = false;

    const queue = tracks.filter(
      (t) =>
        !t.duration &&
        durationsRef.current[t.id] === undefined &&
        !failedRef.current.has(t.id)
    );
    if (queue.length === 0) return;

    const worker = async () => {
      while (!cancelled) {
        const track = queue.shift();
        if (!track) return;

        const url = getAudioUrl ? getAudioUrl(track) : track.audioUrl;
        if (!url) {
          failedRef.current.add(track.id);
          continue;
        }

        const d = await readAudioDuration(url);
        if (cancelled) return;

        if (d) {
          setDurations((prev) => {
            const next = { ...prev, [track.id]: d };
            try {
              localStorage.setItem(DURATION_CACHE_KEY, JSON.stringify(next));
            } catch {
              // ignore
            }
            return next;
          });
        } else {
          failedRef.current.add(track.id);
        }
      }
    };

    for (let i = 0; i < CONCURRENCY; i++) worker();

    return () => {
      cancelled = true;
    };
  }, [tracks, getAudioUrl]);

  // Filtered tracks based on search query
  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tracks;

    return tracks.filter((t) => {
      return (
        t.name.toLowerCase().includes(q) ||
        (t.cleanName && t.cleanName.toLowerCase().includes(q))
      );
    });
  }, [tracks, searchQuery]);

  // mm:ss
  const formatDuration = (seconds?: number): string => {
    if (seconds === undefined || !Number.isFinite(seconds)) return '--:--';
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-3.5">
      {/* Search Bar Only (Filtered chips row completely removed) */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
        <div className="relative">
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
      </div>

      {/* Track Count / Status */}
      <div className="flex items-center justify-between px-1 text-xs text-slate-500 font-medium">
        <span>共 {filteredTracks.length} 首音檔</span>
        {searchQuery && (
          <span>找到 {filteredTracks.length} 筆符合</span>
        )}
      </div>

      {/* Track List Body */}
      {filteredTracks.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-10 text-center shadow-sm space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mx-auto">
            <Music className="w-7 h-7" />
          </div>
          <div>
            <h4 className="text-base font-bold text-slate-800">
              {tracks.length === 0 ? '尚未載入音檔' : '找不到符合條件的音檔'}
            </h4>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
              {tracks.length === 0
                ? '請確認資料夾已設為「知道連結的任何人」可檢視，然後按上方的「重新整理」或「更換資料夾」。若是私人資料夾，可以登入 Google 後讀取。'
                : searchQuery
                ? `沒有包含「${searchQuery}」的檔案`
                : '目前資料夾中沒有音檔'}
            </p>
          </div>

          {tracks.length === 0 && onAuthorize && !hasAccessToken && (
            <div className="pt-2">
              <button
                onClick={onAuthorize}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 active:scale-95 transition"
              >
                <span>登入 Google 讀取（私人資料夾）</span>
              </button>
            </div>
          )}

          {searchQuery && tracks.length > 0 && (
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition"
            >
              清除搜尋
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden shadow-sm">
          {filteredTracks.map((track) => {
            const isCurrent = track.id === currentTrackId;
            const isCurrentPlaying = isCurrent && isPlaying;
            const trackDuration = track.duration || durations[track.id];

            return (
              <div
                key={track.id}
                onClick={() => {
                  if (isCurrent) {
                    onTogglePlay();
                  } else {
                    onPlayTrack(track);
                  }
                }}
                className={`px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer group transition-colors select-none ${
                  isCurrent
                    ? 'bg-indigo-50/80 hover:bg-indigo-50 border-l-4 border-l-indigo-600'
                    : 'hover:bg-slate-50/90 border-l-4 border-l-transparent'
                }`}
              >
                {/* Left: Prominent Play Button + Full Filename */}
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isCurrent) {
                        onTogglePlay();
                      } else {
                        onPlayTrack(track);
                      }
                    }}
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all shadow-sm ${
                      isCurrentPlaying
                        ? 'bg-indigo-600 text-white shadow-indigo-200 scale-105'
                        : isCurrent
                        ? 'bg-indigo-600 text-white shadow-indigo-200'
                        : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white group-hover:bg-indigo-600 group-hover:text-white'
                    }`}
                    title={isCurrentPlaying ? '暫停' : '播放音檔'}
                  >
                    {isCurrentPlaying ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>

                  {/* Complete Original Filename */}
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-sm font-semibold break-all leading-relaxed transition-colors ${
                        isCurrent ? 'text-indigo-950 font-bold' : 'text-slate-800'
                      }`}
                      title={track.name}
                    >
                      {track.name}
                    </div>
                  </div>
                </div>

                {/* Right: Duration (mm:ss) */}
                <div className="text-xs text-slate-400 font-mono shrink-0 tabular-nums">
                  {formatDuration(trackDuration)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
