import { useState, useEffect, useRef, useCallback } from 'react';
import { AudioTrack, RepeatMode, ABRepeat } from '../types/track';
import { getDirectAudioUrl } from '../lib/driveParser';

// In-memory cache for audio object URLs so files don't re-download
const audioBlobCache = new Map<string, string>();

export function useAudioPlayer(accessToken?: string | null, onRequestAuth?: () => void) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      handleTrackEnd();
    };

    const onError = () => {
      setIsLoadingAudio(false);
      setIsPlaying(false);
      // Give clear guidance why playback failed
      setAudioError('音檔載入失敗。Google 雲端硬碟禁止第三方網站匿名串流，請點擊上方授權 Google 讀取。');
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

        // 1. Check if already in memory blob cache
        if (audioBlobCache.has(track.id)) {
          streamUrl = audioBlobCache.get(track.id)!;
        } 
        // 2. Direct web URL (e.g. sample sounds, local blob object URL)
        else if (track.audioUrl && !track.audioUrl.includes('drive.google.com')) {
          streamUrl = track.audioUrl;
        } 
        // 3. Google Drive Audio File
        else {
          // If we have an OAuth token, fetch media binary directly
          if (accessToken) {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${track.id}?alt=media`, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });

            if (!res.ok) {
              throw new Error(`Google Drive API 錯誤 (${res.status})，請重新連線 Google 帳號。`);
            }

            const blob = await res.blob();
            streamUrl = URL.createObjectURL(blob);
            audioBlobCache.set(track.id, streamUrl);
          } else {
            // No access token: Google Drive blocks anonymous audio stream requests
            setAudioError('此音檔來自 Google Drive，因為 Google 安全防護機制，請先點擊上方「授權 Google 讀取」以串流播放！');
            setIsLoadingAudio(false);
            if (onRequestAuth) onRequestAuth();
            return;
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
            artist: '課本音檔學習播放器',
            album: '課本隨身音檔',
            artwork: [
              { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
              { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            ],
          });
          navigator.mediaSession.playbackState = 'playing';
        }
      } catch (err: any) {
        console.error('Play track failed:', err);
        setAudioError(err.message || '音檔播放失敗，請檢查網址連結或點擊授權讀取。');
        setIsLoadingAudio(false);
      }
    },
    [playlist, playbackRate, volume, isMuted, accessToken, onRequestAuth]
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
