/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AudioTrack } from './types/track';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { 
  DEFAULT_FOLDER_ID, 
  fetchFolderAudioTracks, 
  extractFolderId, 
  getTrackPlayableUrl 
} from './lib/driveApi';
import { googleSignIn, initAuth } from './lib/firebase';

// Components
import { TrackListView } from './components/TrackListView';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { DriveFolderInputModal } from './components/DriveFolderInputModal';
import { SleepTimerModal } from './components/SleepTimerModal';
import { GoogleAuthModal } from './components/GoogleAuthModal';

import { 
  FolderSync, 
  FolderOpen, 
  AlertCircle,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';

const DURATION_CACHE_KEY = 'tb_track_durations';

export default function App() {
  // Folder URL / ID state
  const [folderUrl, setFolderUrl] = useState<string>(() => {
    return localStorage.getItem('tb_folder_url') || `https://drive.google.com/drive/folders/${DEFAULT_FOLDER_ID}`;
  });
  const [folderName, setFolderName] = useState<string>('音檔資料夾');
  const [tracks, setTracks] = useState<AudioTrack[]>(() => {
    try {
      const stored = localStorage.getItem('tb_folder_tracks');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse cached tracks:', e);
    }
    return [];
  });

  const [isLoadingFolder, setIsLoadingFolder] = useState<boolean>(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState<boolean>(false);

  // 每首音檔的時長（秒），播放過才會記錄，並存在 localStorage
  const [durations, setDurations] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(DURATION_CACHE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return {};
  });
  const lastSeenIdRef = useRef<string | undefined>(undefined);
  const lastSeenDurationRef = useRef<number>(0);

  // Modals state
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [isSleepModalOpen, setIsSleepModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [pendingTrack, setPendingTrack] = useState<AudioTrack | null>(null);

  // Authorize Google Drive handler（僅供私人資料夾使用，公開資料夾不需要）
  const handleAuthorize = async (trackToPlay?: AudioTrack | null) => {
    setIsAuthorizing(true);
    try {
      const res = await googleSignIn();
      if (res?.accessToken) {
        setAccessToken(res.accessToken);
        setIsAuthModalOpen(false);
        const targetTrack = trackToPlay || pendingTrack;
        setPendingTrack(null);

        // Load entire folder with the fresh token
        await loadEntireFolder(folderUrl, false, res.accessToken, targetTrack);
      }
    } catch (e) {
      console.warn('Authorization cancelled or failed:', e);
    } finally {
      setIsAuthorizing(false);
    }
  };

  // Audio player hook with accessToken
  const player = useAudioPlayer(accessToken, handleAuthorize);

  // 播放時記錄目前這首的時長
  useEffect(() => {
    const id = player.currentTrack?.id;
    const d = player.duration;
    if (!id) return;
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return;

    const trackChanged = lastSeenIdRef.current !== id;
    lastSeenIdRef.current = id;

    // 剛切歌時，duration 可能還是上一首的值，先略過
    if (trackChanged && d === lastSeenDurationRef.current) return;

    lastSeenDurationRef.current = d;

    setDurations((prev) => {
      if (prev[id] !== undefined && Math.abs(prev[id] - d) < 0.5) return prev;
      const next = { ...prev, [id]: d };
      try {
        localStorage.setItem(DURATION_CACHE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [player.duration, player.currentTrack?.id]);

  // Listen to auth
  useEffect(() => {
    const unsub = initAuth((user, token) => {
      setAccessToken(token);
    });
    return () => unsub();
  }, []);

  // Sync playlist with tracks
  useEffect(() => {
    player.setPlaylist(tracks);
  }, [tracks]);

  // Load a complete Google Drive folder
  const loadEntireFolder = useCallback(
    async (
      targetUrlOrId: string, 
      forceAuth = false, 
      explicitToken?: string | null, 
      trackToPlayAfter?: AudioTrack | null
    ) => {
      const folderId = extractFolderId(targetUrlOrId);
      setIsLoadingFolder(true);
      setFolderError(null);

      let token = explicitToken !== undefined ? explicitToken : accessToken;

      // 只有使用者主動按「登入 Google」時才要求授權（私人資料夾）
      if (forceAuth && !token) {
        try {
          const authResult = await googleSignIn();
          if (authResult?.accessToken) {
            token = authResult.accessToken;
            setAccessToken(token);
          }
        } catch (e: any) {
          console.warn('Sign-in cancelled or failed:', e);
          setIsLoadingFolder(false);
          setFolderError('登入授權已取消，無法讀取私人資料夾。');
          return;
        }
      }

      try {
        const result = await fetchFolderAudioTracks(folderId, token);
        setFolderName(result.folderName);
        setTracks(result.tracks);
        player.setPlaylist(result.tracks);

        // Persist to localStorage so the app loads instantly without re-fetching
        localStorage.setItem('tb_folder_url', targetUrlOrId);
        localStorage.setItem('tb_folder_tracks', JSON.stringify(result.tracks));
        localStorage.setItem('tb_folder_name', result.folderName);
        setIsFolderModalOpen(false);

        if (trackToPlayAfter) {
          // Play the requested track right away
          const matched = result.tracks.find(t => t.id === trackToPlayAfter.id) || trackToPlayAfter;
          player.playTrack(matched, result.tracks);
        }
      } catch (err: any) {
        console.error('Failed to load entire folder:', err);
        // 直接顯示 driveApi 給的具體原因，不再一律要求授權
        setFolderError(err?.message || '讀取資料夾失敗，請稍後再試。');
      } finally {
        setIsLoadingFolder(false);
      }
    },
    [accessToken, player]
  );

  // Play track handler — 公開資料夾不需要登入，直接播放
  const handleTrackClick = (track: AudioTrack) => {
    player.playTrack(track, tracks);
  };

  // Initial load if no tracks cached
  useEffect(() => {
    if (tracks.length === 0) {
      loadEntireFolder(folderUrl);
    }
  }, []);

  // Keyboard Shortcuts:
  // Space (播放/暫停)、←/→ (±3 秒)、Shift+N (下一個音檔)、Shift+P (上一個音檔)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
         target.tagName === 'TEXTAREA' ||
         target.isContentEditable)
      ) {
        return;
      }

      // 有按 Ctrl / Cmd / Alt 就不攔截，避免和瀏覽器快捷鍵衝突
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.shiftKey && e.code === 'KeyN') {
        e.preventDefault();
        player.nextTrack();
      } else if (e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        player.prevTrack();
      } else if (e.code === 'Space') {
        e.preventDefault();
        player.togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        player.skip(-3);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        player.skip(3);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [player]);

  return (
    <div className="min-h-screen bg-white text-[#36415A] font-light flex flex-col selection:bg-[#36415A] selection:text-[#E0F8C7]">
      {/* Main Navigation Header (Light Theme) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          {/* Logo & Title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <img ... />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight whitespace-nowrap truncate">
                Easy Audio - 播放音檔不卡卡
              </h1>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                讀取 Google Drive 資料夾 · 空白鍵暫停/播放 · 左右鍵 ±3秒 · Shift+N 下一首 · Shift+P 上一首
              </p>
            </div>
          </div>

          {/* Right Header Actions */}
            <div className="flex items-center gap-2 shrink-0">
            {/* Google 登入：僅私人資料夾需要，公開資料夾可不登入 */}
            {accessToken ? (
              <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>已登入 Google</span>
              </span>
            ) : (
              <button
                onClick={() => handleAuthorize()}
                disabled={isAuthorizing}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 bg-slate-100 hover:bg-slate-200 text-slate-700 transition border border-slate-200"
                title="只有私人資料夾才需要登入 Google；公開資料夾不用登入"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                <span>{isAuthorizing ? '登入中...' : '登入 Google（私人資料夾）'}</span>
              </button>
            )}

            {/* Change Entire Drive Folder Button */}
            <button
              onClick={() => {
                setFolderError(null);
                setIsFolderModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition border border-slate-200"
              title="更換整份 Google Drive 資料夾"
            >
              <FolderOpen className="w-3.5 h-3.5 text-indigo-600" />
              <span>更換資料夾</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-4 space-y-4 pb-32">
        {/* Drive Folder Status Banner */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <FolderSync className={`w-5 h-5 ${isLoadingFolder ? 'animate-spin' : ''}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-slate-800 text-sm truncate">{folderName}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100">
                  {tracks.length} 首音檔
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => loadEntireFolder(folderUrl, false)}
              disabled={isLoadingFolder}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/60 active:scale-95 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFolder ? 'animate-spin' : ''}`} />
              <span>{isLoadingFolder ? '讀取中...' : '重新整理'}</span>
            </button>
          </div>
        </div>

        {/* Error banner：顯示實際原因；私人資料夾可選擇登入 Google */}
        {folderError && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm text-xs text-amber-900 space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium leading-relaxed">{folderError}</div>
            </div>
            {!accessToken && (
              <div className="pt-1 flex items-center justify-between gap-3">
                <span className="text-amber-800/80">如果這是私人資料夾，可以登入 Google 後再讀取。</span>
                <button
                  onClick={() => loadEntireFolder(folderUrl, true)}
                  className="shrink-0 flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold px-4 py-2 rounded-xl shadow-sm active:scale-95 transition text-xs"
                >
                  <span>登入 Google 讀取</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Track List View with Search only (selected filter row removed, placeholder="搜尋...") */}
        <TrackListView
          tracks={tracks}
          durations={durations}
          currentTrackId={player.currentTrack?.id}
          isPlaying={player.isPlaying}
          onPlayTrack={handleTrackClick}
          onTogglePlay={player.togglePlay}
          onAuthorize={() => handleAuthorize()}
          hasAccessToken={!!accessToken}
        />
      </main>

      {/* Persistent Bottom Audio Player (Light Mode with 3s skip) */}
      <AudioPlayerBar
        currentTrack={player.currentTrack}
        isPlaying={player.isPlaying}
        currentTime={player.currentTime}
        duration={player.duration}
        playbackRate={player.playbackRate}
        repeatMode={player.repeatMode}
        volume={player.volume}
        isMuted={player.isMuted}
        isLoading={player.isLoadingAudio}
        audioError={player.audioError}
        abRepeat={player.abRepeat}
        sleepTimerMinutes={player.sleepTimerMinutes}
        sleepTimerSecondsLeft={player.sleepTimerSecondsLeft}
        onTogglePlay={player.togglePlay}
        onNext={player.nextTrack}
        onPrev={player.prevTrack}
        onSeek={player.seek}
        onSkip={player.skip}
        onChangePlaybackRate={player.changePlaybackRate}
        onSetRepeatMode={player.setRepeatMode}
        onChangeVolume={player.changeVolume}
        onToggleMute={player.toggleMute}
        onSetPointA={player.setPointA}
        onSetPointB={player.setPointB}
        onClearAB={player.clearABRepeat}
        onOpenSleepTimer={() => setIsSleepModalOpen(true)}
        onAuthorizeGoogle={() => handleAuthorize()}
      />

      {/* Google Drive Entire Folder Input Modal */}
      <DriveFolderInputModal
        isOpen={isFolderModalOpen}
        onClose={() => setIsFolderModalOpen(false)}
        currentFolderUrl={folderUrl}
        onLoadFolder={async (newUrl) => {
          setFolderUrl(newUrl);
          await loadEntireFolder(newUrl, false);
        }}
        isLoading={isLoadingFolder}
        error={folderError}
      />

      {/* Sleep Timer Modal */}
      <SleepTimerModal
        isOpen={isSleepModalOpen}
        onClose={() => setIsSleepModalOpen(false)}
        currentMinutes={player.sleepTimerMinutes}
        secondsLeft={player.sleepTimerSecondsLeft}
        onSetTimer={player.setSleepTimer}
      />

      {/* Google Authorization Dialog（私人資料夾備案，公開資料夾不會自動跳出） */}
      <GoogleAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
          setPendingTrack(null);
        }}
        onAuthorize={async () => {
          await handleAuthorize(pendingTrack);
        }}
        isLoading={isAuthorizing}
        pendingTrackName={pendingTrack?.name}
      />
    </div>
  );
}
