import { useState, useEffect, useRef, useCallback } from 'react';
import { AudioTrack, RepeatMode, ABRepeat } from '../types/track';
import { getTrackPlayableUrl } from '../lib/driveApi';

// In-memory cache for audio object URLs so files don't re-download
const audioBlobCache = new Map<string, string>();

// onRequestAuth 保留參數以維持相容；公開資料夾不再需要它
export function useAudioPlayer(accessToken?: string | null, _onRequestAuth?: () => void) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 讓 audio 的 ended 事件永遠呼叫最新版本的 handleTrackEnd（避免拿到舊的空 playlist）
  const handleTrackEndRef = useRef<() => void>(() => {});

  const [playlist, setPlaylist] = useState<AudioTrack[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('repeat-all');
  const [volume, setVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  // A-B Loop
  const [abRepeat, setAbRepeat] = useState<ABRepeat>({
    enabled: false,
    pointA: null,
    pointB: null,
  });

  // Sleep Timer
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [sleepTimerSecondsLeft, setSleepTimerSecondsLeft] = useState<number | null>(null);

  const currentTrack = playlist[currentTrackIndex] || null;

  // Initialize Audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    const onTimeUpdate = () => {
      const cur = audio.currentTime;
      setCurrentTime(cur);

      // Handle A-B loop check
      setAbRepeat((prev) => {
        if (prev.enabled && prev.pointA !== null && prev.pointB !== null) {
          if (cur >= prev.pointB) {
            audio.currentTime = prev.pointA;
          }
        }
        return prev;
      });
    };

    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      setIsLoadingAudio(false);
      setAudioError(null);
    };

    const onEnded = () => {
      handleTrackEndRef.current();
    };

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

  // Sleep Timer countdown
  useEffect(() => {
    if (sleepTimerSecondsLeft === null || sleepTimerSecondsLeft <= 0) return;

    const interval = setInterval(() => {
      setSleepTimerSecondsLeft((prev) => {
        if (prev === null || prev <= 1) {
          if (audioRef.current) audioRef.current.pause();
          setIsPlaying(false);
          setSleepTimerMinutes(null);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [sleepTimerSecondsLeft]);

  // Set Sleep Timer
  const setSleepTimer = (minutes: number | null) => {
    setSleepTimerMinutes(minutes);
    if (minutes === null) {
      setSleepTimerSecondsLeft(null);
    } else {
      setSleepTimerSecondsLeft(minutes * 60);
    }
  };

  // Load and play track
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
        let streamUrl: string | null = null;

        // 1. Already in memory blob cache
        if (audioBlobCache.has(track.id)) {
          streamUrl = audioBlobCache.get(track.id)!;
        } else {
          // 2. 由 driveApi 決定：
          //    - 已登入 → 用 Bearer token 下載（可播私人檔案）
          //    - 未登入 → 直接用 Drive API + API Key 的公開串流網址
          streamUrl = await getTrackPlayableUrl(track, accessToken);
          if (streamUrl && streamUrl.startsWith('blob:')) {
            audioBlobCache.set(track.id, streamUrl);
          }
        }

        if (!streamUrl) {
          throw new Error('無法取得可播放的音訊串流網址');
        }

        audio.src = streamUrl;
        audio.playbackRate = playbackRate;
        audio.volume = isMuted ? 0 : volume;

        await audio.play();
        setIsPlaying(true);

        // Update Media Session for lock screen controls
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: 'Easy Audio',
            album: 'Easy Audio',
            artwork: [
              { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
              { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            ],
          });
          navigator.mediaSession.playbackState = 'playing';
        }
      } catch (err: any) {
        console.error('Play track failed:', err);
        setAudioError(err.message || '音檔播放失敗，請確認檔案已公開分享。');
        setIsLoadingAudio(false);
      }
    },
    [playlist, playbackRate, volume, isMuted, accessToken]
  );

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) {
      if (playlist.length > 0) {
        playTrack(playlist[0]);
      }
      return;
    }

    if (audio.paused) {
      audio.play().then(() => {
        setIsPlaying(true);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      });
    } else {
      audio.pause();
      setIsPlaying(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    }
  }, [playlist, playTrack]);

  // Next Track
  const nextTrack = useCallback(() => {
    if (playlist.length === 0) return;
    if (repeatMode === 'shuffle') {
      const nextIndex = Math.floor(Math.random() * playlist.length);
      playTrack(playlist[nextIndex]);
      return;
    }
    const nextIndex = (currentTrackIndex + 1) % playlist.length;
    playTrack(playlist[nextIndex]);
  }, [playlist, currentTrackIndex, repeatMode, playTrack]);

  // Previous Track
  const prevTrack = useCallback(() => {
    if (playlist.length === 0) return;
    const prevIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
    playTrack(playlist[prevIndex]);
  }, [playlist, currentTrackIndex, playTrack]);

  // Handle track end based on repeat mode
  const handleTrackEnd = () => {
    if (repeatMode === 'repeat-one') {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      }
    } else if (repeatMode === 'repeat-all' || repeatMode === 'shuffle') {
      nextTrack();
    } else {
      if (currentTrackIndex < playlist.length - 1) {
        nextTrack();
      } else {
        setIsPlaying(false);
      }
    }
  };
  // 每次 render 都更新，確保 ended 事件用到最新的 playlist / repeatMode
  handleTrackEndRef.current = handleTrackEnd;

  // Seek
  const seek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  // Skip relative (+/- seconds)
  const skip = (deltaSeconds: number) => {
    if (audioRef.current) {
      const nextTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + deltaSeconds));
      seek(nextTime);
    }
  };

  // Change playback speed
  const changePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  // A-B Repeat methods
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

  const clearABRepeat = () => {
    setAbRepeat({ enabled: false, pointA: null, pointB: null });
  };

  const toggleABRepeat = () => {
    if (abRepeat.enabled) {
      clearABRepeat();
    } else if (abRepeat.pointA !== null && abRepeat.pointB !== null) {
      setAbRepeat((prev) => ({ ...prev, enabled: true }));
      seek(abRepeat.pointA);
    }
  };

  // Volume
  const changeVolume = (val: number) => {
    setVolume(val);
    setIsMuted(val === 0);
    if (audioRef.current) {
      audioRef.current.volume = val;
    }
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioRef.current) {
      audioRef.current.volume = nextMuted ? 0 : volume;
    }
  };

  // Setup MediaSession action handlers (3s forward / backward)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
    navigator.mediaSession.setActionHandler('seekbackward', () => skip(-3));
    navigator.mediaSession.setActionHandler('seekforward', () => skip(3));
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) seek(details.seekTime);
    });
  }, [togglePlay, prevTrack, nextTrack, skip, seek]);

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
    sleepTimerMinutes,
    sleepTimerSecondsLeft,
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
    toggleABRepeat,
    setSleepTimer,
  };
}
