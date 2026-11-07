import { useState, useEffect, useRef, useCallback } from 'react';
import { AudioTrack, RepeatMode, ABRepeat } from '../types/track';
import { getTrackPlayableUrl } from '../lib/driveApi';

// 記憶體快取：已下載成 blob 的音檔網址，避免重複下載
const audioBlobCache = new Map<string, string>();

// 預設的循環模式：一般播放（播完就停止，不自動播下一首）。
// 這個值必須是 RepeatMode 裡代表「一般播放」的那個字串；
// 如果你的 types/track.ts 用的不是 'off'（例如 'none' 或 'normal'），只要改這一行。
const DEFAULT_REPEAT_MODE: RepeatMode = 'off' as RepeatMode;

const setPlaybackState = (state: MediaSessionPlaybackState) => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
};

// _onRequestAuth 保留參數以維持相容；公開資料夾不再需要它
export function useAudioPlayer(accessToken?: string | null, _onRequestAuth?: () => void) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 讓 audio 的 ended 事件永遠呼叫最新版本的 handleTrackEnd（避免拿到舊的空 playlist）
  const handleTrackEndRef = useRef<() => void>(() => {});

  const [playlist, setPlaylist] = useState<AudioTrack[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(DEFAULT_REPEAT_MODE);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  // A-B 區間循環
  const [abRepeat, setAbRepeat] = useState<ABRepeat>({ enabled: false, pointA: null, pointB: null });
  const abRepeatRef = useRef(abRepeat);
  abRepeatRef.current = abRepeat;
  
  const currentTrack = playlist[currentTrackIndex] || null;

  // 建立 Audio 元素（只建立一次）
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);

      // A-B 循環：播到 B 點就跳回 A 點
      const { enabled, pointA, pointB } = abRepeatRef.current;
      if (enabled && pointA !== null && pointB !== null && audio.currentTime >= pointB) {
        audio.currentTime = pointA;
      }
    };
    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      setIsLoadingAudio(false);
      setAudioError(null);
    };
    const onEnded = () => handleTrackEndRef.current();
    const onError = () => {
      setIsLoadingAudio(false);
      setIsPlaying(false);
      setAudioError(
        '音檔載入失敗。請確認檔案已設為「知道連結的任何人」可檢視，且網站的 API Key 設定正確。若是私人檔案，請登入 Google 後再播放。'
      );
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.src = '';
    };
  }, []);

  // 載入並播放指定音檔
  const playTrack = useCallback(
    async (track: AudioTrack, trackList?: AudioTrack[]) => {
      const audio = audioRef.current;
      if (!audio) return;

      const activeList = trackList || playlist;
      if (trackList) setPlaylist(trackList);

      const index = activeList.findIndex((t) => t.id === track.id);
      setCurrentTrackIndex(index !== -1 ? index : 0);

      setIsLoadingAudio(true);
      setAudioError(null);

      try {
        // 1. 記憶體快取有就直接用
        // 2. 否則由 driveApi 決定：已登入用 Bearer token 下載（可播私人檔案），
        //    未登入直接用 Drive API + API Key 的公開串流網址
        let url = audioBlobCache.get(track.id);
        if (!url) {
          url = await getTrackPlayableUrl(track, accessToken);
          if (url?.startsWith('blob:')) audioBlobCache.set(track.id, url);
        }
        if (!url) throw new Error('無法取得可播放的音訊串流網址');

        audio.src = url;
        audio.playbackRate = playbackRate;
        audio.volume = isMuted ? 0 : volume;

        await audio.play();
        setIsPlaying(true);

        // 鎖定畫面的媒體控制資訊
        if ('mediaSession' in navigator) {
          const icon = (file: string) => `${import.meta.env.BASE_URL}${file}`;
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: 'Easy Audio',
            album: 'Easy Audio',
            artwork: [
              { src: icon('pwa-192x192.png'), sizes: '192x192', type: 'image/png' },
              { src: icon('pwa-512x512.png'), sizes: '512x512', type: 'image/png' },
            ],
          });
          setPlaybackState('playing');
        }
      } catch (err: any) {
        console.error('Play track failed:', err);
        setAudioError(err.message || '音檔播放失敗，請確認檔案已公開分享。');
        setIsLoadingAudio(false);
      }
    },
    [playlist, playbackRate, volume, isMuted, accessToken]
  );

  // 播放 / 暫停
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.src) {
      if (playlist.length > 0) playTrack(playlist[0]);
      return;
    }

    if (audio.paused) {
      audio.play().then(() => {
        setIsPlaying(true);
        setPlaybackState('playing');
      });
    } else {
      audio.pause();
      setIsPlaying(false);
      setPlaybackState('paused');
    }
  }, [playlist, playTrack]);

  // 下一首
  const nextTrack = useCallback(() => {
    if (playlist.length === 0) return;
    const nextIndex =
      repeatMode === 'shuffle'
        ? Math.floor(Math.random() * playlist.length)
        : (currentTrackIndex + 1) % playlist.length;
    playTrack(playlist[nextIndex]);
  }, [playlist, currentTrackIndex, repeatMode, playTrack]);

  // 上一首
  const prevTrack = useCallback(() => {
    if (playlist.length === 0) return;
    playTrack(playlist[(currentTrackIndex - 1 + playlist.length) % playlist.length]);
  }, [playlist, currentTrackIndex, playTrack]);

  // 播完一首之後，依循環模式決定下一步
  // 每次 render 都更新，確保 ended 事件用到最新的 playlist / repeatMode
  handleTrackEndRef.current = () => {
    const audio = audioRef.current;
    if (repeatMode === 'repeat-one') {
      // 單曲循環：回到開頭重播
      if (audio) {
        audio.currentTime = 0;
        audio.play();
      }
    } else if (repeatMode === 'repeat-all' || repeatMode === 'shuffle') {
      // 只有「循環播放」與「隨機播放」才會自動接著播下一首
      nextTrack();
    } else {
      // 一般模式：播完就停止，不自動播下一首（不呼叫 nextTrack）
      setIsPlaying(false);
      setPlaybackState('paused');
    }
  };

  // 跳到指定秒數
  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  // 相對跳轉（正數快轉、負數倒退）
  const skip = useCallback(
    (deltaSeconds: number) => {
      const audio = audioRef.current;
      if (audio) seek(Math.max(0, Math.min(audio.duration || 0, audio.currentTime + deltaSeconds)));
    },
    [seek]
  );

  const changePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  // A-B 循環
  const setPointA = () => {
    const cur = audioRef.current?.currentTime || 0;
    setAbRepeat((prev) => ({
      ...prev,
      enabled: prev.pointB !== null && cur < prev.pointB,
      pointA: cur,
    }));
  };

  const setPointB = () => {
    const cur = audioRef.current?.currentTime || 0;
    setAbRepeat((prev) => ({
      ...prev,
      enabled: prev.pointA !== null && cur > prev.pointA,
      pointB: cur,
    }));
  };

  const clearABRepeat = () => setAbRepeat({ enabled: false, pointA: null, pointB: null });

  // 音量
  const changeVolume = (val: number) => {
    setVolume(val);
    setIsMuted(val === 0);
    if (audioRef.current) audioRef.current.volume = val;
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioRef.current) audioRef.current.volume = nextMuted ? 0 : volume;
  };

  // 鎖定畫面 / 耳機的控制按鈕（快轉、倒退各 3 秒）
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;

    session.setActionHandler('play', togglePlay);
    session.setActionHandler('pause', togglePlay);
    session.setActionHandler('previoustrack', prevTrack);
    session.setActionHandler('nexttrack', nextTrack);
    session.setActionHandler('seekbackward', () => skip(-3));
    session.setActionHandler('seekforward', () => skip(3));
    session.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) seek(details.seekTime);
    });
  }, [togglePlay, prevTrack, nextTrack, skip, seek]);

  // 取得「指定音檔」的 Blob（不一定是正在播放的那首），供語音辨識使用。
  // 批次辨識整個資料夾時，會對清單裡的每一首呼叫這個函式。
  const getTrackAudioBlob = useCallback(
    async (track: AudioTrack): Promise<Blob | null> => {
      try {
        // 1. 已經有記憶體快取的 blob 網址（播放過、或之前下載過）就直接用
        const cachedUrl = audioBlobCache.get(track.id);
        if (cachedUrl) {
          const res = await fetch(cachedUrl);
          return await res.blob();
        }

        // 2. 否則透過 driveApi 取得可播放網址並下載
        const playableUrl = await getTrackPlayableUrl(track, accessToken);
        if (!playableUrl) return null;

        // 已登入時 driveApi 會回傳 blob: 網址，存進快取，之後播放這一首就不用再下載一次
        if (playableUrl.startsWith('blob:')) audioBlobCache.set(track.id, playableUrl);

        const res = await fetch(playableUrl);
        if (!res.ok) throw new Error(`下載音檔失敗（HTTP ${res.status}）`);
        return await res.blob();
      } catch (e) {
        console.warn('Failed to retrieve audio blob for transcription:', e);
        return null;
      }
    },
    [accessToken]
  );

  // 取得目前播放中音檔的 Blob（保留給舊的呼叫方式使用）
  const getCurrentAudioBlob = useCallback(async (): Promise<Blob | null> => {
    if (!currentTrack) return null;
    return getTrackAudioBlob(currentTrack);
  }, [currentTrack, getTrackAudioBlob]);

  return {
    currentTrack,
    currentTrackIndex,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    repeatMode,
    volume,
    isMuted,
    isLoadingAudio,
    audioError,
    abRepeat,
    playlist,
    setPlaylist,
    playTrack,
    togglePlay,
    nextTrack,
    prevTrack,
    seek,
    skip,
    changePlaybackRate,
    setRepeatMode,
    changeVolume,
    toggleMute,
    setPointA,
    setPointB,
    clearABRepeat,
    getCurrentAudioBlob,
    getTrackAudioBlob,
  };
}