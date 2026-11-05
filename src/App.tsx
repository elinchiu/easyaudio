/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AudioTrack } from './types/track';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { fetchFolderAudioTracks, extractFolderId } from './lib/driveApi';
import { googleSignIn, initAuth } from './lib/firebase';

// Components
import { TrackListView } from './components/TrackListView';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { GoogleAuthModal } from './components/GoogleAuthModal';
import { PWAInstallButton } from './components/PWAInstallButton';

import { 
  FolderSync, 
  Link2,
  AlertCircle,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';

const DURATION_CACHE_KEY = 'tb_track_durations';

export default function App() {
  // 每次載入／重整都從空白開始：不從 localStorage 還原資料夾與歌單
  const [folderUrl, setFolderUrl] = useState<string>('');
  const [folderName, setFolderName] = useState<string>('File Name');
  const [tracks, setTracks] = useState<AudioTrack[]>([]);

  const [isLoadingFolder, setIsLoadingFolder] = useState<boolean>(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState<boolean>(false);

  // 貼上資料夾連結的輸入欄
  const [folderInput, setFolderInput] = useState<string>('');

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
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [pendingTrack, setPendingTrack] = useState<AudioTrack | null>(null);

  // 清掉舊版本殘留在瀏覽器裡的資料夾／歌單快取（只跑一次）
  useEffect(() => {
    ['tb_folder_url', 'tb_folder_tracks', 'tb_folder_name'].forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        // ignore
      }
    });
  }, []);

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

        // 只有已經有資料夾時才重新載入；空白狀態下登入就只登入
        if (folderUrl) {
          await loadEntireFolder(folderUrl, false, res.accessToken, targetTrack);
        }
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

  // Load a complete Google Drive folder（回傳 true 代表成功）
  const loadEntireFolder = useCallback(
    async (
      targetUrlOrId: string, 
      forceAuth = false, 
      explicitToken?: string | null, 
      trackToPlayAfter?: AudioTrack | null
    ): Promise<boolean> => {
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
          return false;
        }
      }

      try {
        const result = await fetchFolderAudioTracks(folderId, token);
        setFolderName(result.folderName);
        setTracks(result.tracks);
        player.setPlaylist(result.tracks);

        if (trackToPlayAfter) {
          // Play the requested track right away
          const matched = result.tracks.find(t => t.id === trackToPlayAfter.id) || trackToPlayAfter;
          player.playTrack(matched, result.tracks);
        }
        return true;
      } catch (err: any) {
        console.error('Failed to load entire folder:', err);
        // 直接顯示 driveApi 給的具體原因，不再一律要求授權
        setFolderError(err?.message || '讀取資料夾失敗，請稍後再試。');
        return false;
      } finally {
        setIsLoadingFolder(false);
      }
    },
    [accessToken, player]
  );

  // 按「匯入」：載入貼上的資料夾連結
  const handleImport = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const url = folderInput.trim();
    if (!url || isLoadingFolder) return;

    setFolderUrl(url);
    const ok = await loadEntireFolder(url, false);
    // 成功才清空輸入欄；失敗時保留，方便使用者修改後重試
    if (ok) setFolderInput('');
  };

  // Play track handler — 公開資料夾不需要登入，直接播放
  const handleTrackClick = (track: AudioTrack) => {
    player.playTrack(track, tracks);
  };

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
            <img
              src={`${import.meta.env.BASE_URL}icon.jpeg`}
              alt="Easy Audio"
              className="w-8 h-8 rounded-lg shrink-0"
              width={32}
              height={32}
            />
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
                <span>{isAuthorizing ? '登入中...' : '登入 Google'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-4 space-y-4 pb-32">
        {/* 貼上資料夾連結 + 匯入 */}
        <form
          onSubmit={handleImport}
          className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex items-center gap-2.5"
        >
          <div className="flex-1 min-w-0 flex items-center gap-2.5 bg-[#E0F8C7] rounded-xl px-3.5 py-2.5">
            <Link2 className="w-4 h-4 text-slate-500 shrink-0" />
            <input
              type="text"
              inputMode="url"
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="貼上你的檔案夾"
              aria-label="Google Drive 資料夾連結"
              className="w-full min-w-0 bg-transparent outline-none text-sm text-[#36415A] placeholder:text-slate-500"
            />
          </div>
          <button
            type="submit"
            disabled={isLoadingFolder || !folderInput.trim()}
            className="shrink-0 flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold bg-[#495779] hover:bg-[#3d4a68] text-white shadow-sm active:scale-95 transition disabled:opacity-50 disabled:active:scale-100"
          >
            {isLoadingFolder && (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            <span>{isLoadingFolder ? '匯入中...' : '匯入'}</span>
          </button>
        </form>

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
              disabled={isLoadingFolder || !folderUrl}
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
            <div className="text-amber-800/80 pl-6">
              請確認資料夾（含子資料夾與檔案）的分享設定為「知道連結的任何人 → 檢視者」。
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

      <footer className="text-center text-[11px] text-slate-400 py-6">
        <a href={`${import.meta.env.BASE_URL}privacy.html`} className="hover:underline">Privacy Policy</a>
        <span className="mx-2">·</span>
        <a href={`${import.meta.env.BASE_URL}terms.html`} className="hover:underline">Terms</a>
      </footer>

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
        onAuthorizeGoogle={() => handleAuthorize()}
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