import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AudioTrack } from './types/track';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useTranscriptionQueue } from './hooks/useTranscriptionQueue';
import { fetchFolderAudioTracks, extractFolderId } from './lib/driveApi';
import { googleSignIn, initAuth, getAccessTokenExpiresAt } from './lib/firebase';

import { TrackListView } from './components/TrackListView';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import {
  TranscriptModal,
  TRANSCRIPT_PANEL_DEFAULT_WIDTH,
  clampTranscriptWidth,
} from './components/TranscriptModal';

import {
  FolderSync,
  Link2,
  AlertCircle,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';

const DURATION_CACHE_KEY = 'tb_track_durations';
const TRANSCRIPT_WIDTH_KEY = 'tb_transcript_width';
const SAVED_FOLDER_KEY = 'tb_saved_folder_v1';

interface SavedFolder {
  url: string;
  name: string;
  tracks: AudioTrack[];
}

function readSavedFolder(): SavedFolder | null {
  try {
    const raw = localStorage.getItem(SAVED_FOLDER_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data.url === 'string' && Array.isArray(data.tracks)) {
      return { url: data.url, name: data.name || 'File Name', tracks: data.tracks };
    }
  } catch {}
  return null;
}

const AUTO_TRANSCRIBE_ON_PLAY = true;

export default function App() {
  const [initialSaved] = useState<SavedFolder | null>(readSavedFolder);
  const [folderUrl, setFolderUrl] = useState<string>(initialSaved?.url ?? '');
  const [folderName, setFolderName] = useState<string>(initialSaved?.name ?? 'File Name');
  const [tracks, setTracks] = useState<AudioTrack[]>(initialSaved?.tracks ?? []);

  const [isLoadingFolder, setIsLoadingFolder] = useState<boolean>(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState<boolean>(false);

  const [folderInput, setFolderInput] = useState<string>('');

  const [durations, setDurations] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(DURATION_CACHE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });
  const lastSeenIdRef = useRef<string | undefined>(undefined);
  const lastSeenDurationRef = useRef<number>(0);

  const [isTranscriptModalOpen, setIsTranscriptModalOpen] = useState(false);
  const [isPrivateFolder, setIsPrivateFolder] = useState(false);

  const [transcriptWidth, setTranscriptWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(TRANSCRIPT_WIDTH_KEY));
      if (saved > 0) return clampTranscriptWidth(saved);
    } catch {}
    return TRANSCRIPT_PANEL_DEFAULT_WIDTH;
  });
  const [isResizingPanel, setIsResizingPanel] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(TRANSCRIPT_WIDTH_KEY, String(transcriptWidth));
    } catch {}
  }, [transcriptWidth]);

  useEffect(() => {
    ['tb_folder_url', 'tb_folder_tracks', 'tb_folder_name'].forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });
  }, []);

  const handleAuthorize = async () => {
    setIsAuthorizing(true);
    try {
      const res = await googleSignIn();
      if (res?.accessToken) {
        setAccessToken(res.accessToken);
        if (folderUrl) {
          await loadEntireFolder(folderUrl, false, res.accessToken);
        }
      }
    } catch (e) {
      console.warn('Authorization cancelled or failed:', e);
    } finally {
      setIsAuthorizing(false);
    }
  };

  const player = useAudioPlayer(accessToken);

  const queue = useTranscriptionQueue({ getTrackAudioBlob: player.getTrackAudioBlob });

  const currentTrackRef = useRef<AudioTrack | null>(null);
  currentTrackRef.current = player.currentTrack ?? null;
  const currentTrackId = player.currentTrack?.id;
  const { transcribeOnly } = queue;
  useEffect(() => {
    if (!AUTO_TRANSCRIBE_ON_PLAY || !currentTrackId) return;
    if (currentTrackRef.current) transcribeOnly(currentTrackRef.current);
  }, [currentTrackId, transcribeOnly]);

  useEffect(() => {
    const id = player.currentTrack?.id;
    const d = player.duration;
    if (!id) return;
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return;

    const trackChanged = lastSeenIdRef.current !== id;
    lastSeenIdRef.current = id;

    if (trackChanged && d === lastSeenDurationRef.current) return;

    lastSeenDurationRef.current = d;

    setDurations((prev) => {
      if (prev[id] !== undefined && Math.abs(prev[id] - d) < 0.5) return prev;
      const next = { ...prev, [id]: d };
      try {
        localStorage.setItem(DURATION_CACHE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [player.duration, player.currentTrack?.id]);

  useEffect(() => {
    const unsub = initAuth((_user, token) => {
      setAccessToken(token);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    const msLeft = getAccessTokenExpiresAt() - Date.now();
    if (msLeft <= 0) {
      setAccessToken(null);
      return;
    }
    const timer = setTimeout(() => setAccessToken(null), msLeft);
    return () => clearTimeout(timer);
  }, [accessToken]);

  useEffect(() => {
    player.setPlaylist(tracks);
  }, [tracks]);

  const loadEntireFolder = useCallback(
    async (
      targetUrlOrId: string,
      forceAuth = false,
      explicitToken?: string | null,
      silent = false
    ): Promise<boolean> => {
      const folderId = extractFolderId(targetUrlOrId);
      setIsLoadingFolder(true);
      if (!silent) {
        setFolderError(null);
        setIsPrivateFolder(false);
      }

      let token = explicitToken !== undefined ? explicitToken : accessToken;

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

        try {
          localStorage.setItem(
            SAVED_FOLDER_KEY,
            JSON.stringify({ url: targetUrlOrId, name: result.folderName, tracks: result.tracks })
          );
        } catch {}

        queue.retainOnly(result.tracks);
        return true;
      } catch (err: any) {
        console.error('Failed to load entire folder:', err);
        if (!silent) {
          setFolderError(err?.message || '讀取資料夾失敗，請稍後再試。');
          setIsPrivateFolder(err?.name === 'AuthRequiredError');
        }
        return false;
      } finally {
        setIsLoadingFolder(false);
      }
    },
    [accessToken, queue.retainOnly]
  );

  useEffect(() => {
    if (folderUrl) void loadEntireFolder(folderUrl, false, undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImport = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const url = folderInput.trim();
    if (!url || isLoadingFolder) return;

    setFolderUrl(url);
    const ok = await loadEntireFolder(url, false);
    if (ok) setFolderInput('');
  };

  const handleLoginAndLoad = async () => {
    const url = folderInput.trim() || folderUrl;
    if (!url || isLoadingFolder) return;

    setFolderUrl(url);
    const ok = await loadEntireFolder(url, true);
    if (ok) setFolderInput('');
  };

  const handleTrackClick = (track: AudioTrack) => {
    player.playTrack(track, tracks);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
         target.tagName === 'TEXTAREA' ||
         target.isContentEditable)
      ) {
        return;
      }

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
      } else if (e.code === 'KeyS' && !e.shiftKey && !e.repeat) {
        if (!player.currentTrack) return;
        e.preventDefault();
        setIsTranscriptModalOpen((open) => !open);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [player]);

  return (
    <div
      style={{ ['--transcript-w' as any]: `${transcriptWidth}px` }}
      className={`min-h-screen bg-white text-[#36415A] font-light flex flex-col selection:bg-[#36415A] selection:text-[#E0F8C7] ${
        isResizingPanel ? '' : 'transition-[padding] duration-200'
      } ${isTranscriptModalOpen ? 'lg:pr-[var(--transcript-w)]' : ''}`}
    >
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
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
                空白鍵暫停/播放 · 左右鍵 ±3秒 · Shift + N 下一首 · Shift + P 上一首 · S鍵 開啟/關閉文檔視窗
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-4 space-y-4 pb-32">
        <form
          onSubmit={handleImport}
          className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex flex-wrap items-center gap-2.5"
        >
          <div className="flex-1 min-w-0 flex items-center gap-2.5 bg-[#E0F8C7] rounded-xl px-3.5 py-2.5">
            <Link2 className="w-4 h-4 text-slate-500 shrink-0" />
            <input
              type="text"
              inputMode="url"
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="貼上資料夾連結"
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

          <p className="basis-full px-1 text-xs text-slate-500 leading-relaxed">
            請確認 Google Drive 資料夾已設為「知道連結的任何人」可檢視，再貼上連結並按「匯入」。若是非公開資料夾，可登入 Google 後讀取。
          </p>
        </form>

        {folderError && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm text-xs text-amber-900 space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium leading-relaxed">{folderError}</div>
            </div>
            {!isPrivateFolder && (
              <div className="text-amber-800/80 pl-6">
                請確認資料夾（含子資料夾與檔案）的分享設定為「知道連結的任何人 → 檢視者」。
              </div>
            )}
            {!accessToken && (
              <div className="pt-1 flex items-center justify-between gap-3">
                <span className="text-amber-800/80">
                  若是私人資料夾，請登入 Google 後方可讀取。
                </span>
                <button
                  onClick={handleLoginAndLoad}
                  className="shrink-0 flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold px-4 py-2 rounded-xl shadow-sm active:scale-95 transition text-xs"
                >
                  <span>登入 Google 讀取</span>
                </button>
              </div>
            )}
          </div>
        )}

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

        <TrackListView
          tracks={tracks}
          durations={durations}
          currentTrackId={player.currentTrack?.id}
          isPlaying={player.isPlaying}
          onPlayTrack={handleTrackClick}
          onTogglePlay={player.togglePlay}
        />
      </main>

      <AudioPlayerBar
        currentTrack={player.currentTrack}
        isPlaying={player.isPlaying}
        currentTime={player.currentTime}
        duration={player.duration}
        playbackRate={player.playbackRate}
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
        onChangeVolume={player.changeVolume}
        onToggleMute={player.toggleMute}
        onSetPointA={player.setPointA}
        onSetPointB={player.setPointB}
        onClearAB={player.clearABRepeat}
        onOpenTranscript={() => setIsTranscriptModalOpen((open) => !open)}
      />

      <TranscriptModal
        isOpen={isTranscriptModalOpen}
        onClose={() => setIsTranscriptModalOpen(false)}
        currentTrack={player.currentTrack}
        currentTime={player.currentTime}
        onSeek={player.seekAndPlay}
        queue={queue}
        width={transcriptWidth}
        onWidthChange={setTranscriptWidth}
        onResizingChange={setIsResizingPanel}
      />
    </div>
  );
}