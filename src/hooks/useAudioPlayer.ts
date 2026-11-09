import { useState, useEffect, useRef, useCallback } from 'react';
import { AudioTrack, ABRepeat } from '../types/track';
import { getTrackPlayableUrl, explainMediaUrlError } from '../lib/driveApi';

const audioBlobCache = new Map<string, string>();

const GENERIC_LOAD_ERROR = '音檔載入失敗，正在確認原因，請稍後...';

const UNKNOWN_LOAD_ERROR =
  'Google Drive 有回應，但音檔還是播不出來，可能是網路不穩、暫時無回應，或音檔格式瀏覽器無法解碼。請重整網頁後再試。';

function withLoginHint(message: string, hasToken: boolean): string {
  if (hasToken) return message;
  if (!/分享設定|沒有權限|找不到此/.test(message)) return message;
  return `${message} 若是私人檔案，請登入 Google 後方可讀取。`;
}

const setPlaybackState = (state: MediaSessionPlaybackState) => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
};

const diagnosisCache = new Map<string, Promise<string>>();

function diagnoseLoadFailure(src: string): Promise<string> {
  const cached = diagnosisCache.get(src);
  if (cached) return cached;

  const task = (async () => {
    if (src.includes('googleapis.com')) {
      const real = await explainMediaUrlError(src);
      if (real) return real;
    }
    return UNKNOWN_LOAD_ERROR;
  })();

  diagnosisCache.set(src, task);
  setTimeout(() => diagnosisCache.delete(src), 5000);
  return task;
}

export function useAudioPlayer(accessToken?: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playRequestRef = useRef(0);

  const [playlist, setPlaylist] = useState<AudioTrack[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const [abRepeat, setAbRepeat] = useState<ABRepeat>({ enabled: false, pointA: null, pointB: null });
  const abRepeatRef = useRef(abRepeat);
  abRepeatRef.current = abRepeat;

  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const currentTrack = playlist[currentTrackIndex] || null;

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);

      if (Number.isFinite(audio.duration) && audio.currentTime > audio.duration) {
        setDuration(audio.currentTime);
      }

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
    const onDurationChange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setPlaybackState('paused');
    };
    const onError = () => {
      if (!audio.getAttribute('src')) return;

      setIsLoadingAudio(false);
      setIsPlaying(false);
      setAudioError(GENERIC_LOAD_ERROR);

      const src = audio.src;
      diagnoseLoadFailure(src).then((message) => {
        if (audio.src === src) setAudioError(withLoginHint(message, !!accessTokenRef.current));
      });
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.src = '';
    };
  }, []);

  const playTrack = useCallback(
    async (track: AudioTrack, trackList?: AudioTrack[]) => {
      const audio = audioRef.current;
      if (!audio) return;

      const requestId = ++playRequestRef.current;
      const isStale = () => requestId !== playRequestRef.current;

      const activeList = trackList || playlist;
      if (trackList) setPlaylist(trackList);

      const index = activeList.findIndex((t) => t.id === track.id);
      setCurrentTrackIndex(index !== -1 ? index : 0);

      setIsLoadingAudio(true);
      setAudioError(null);

      try {
        let url = audioBlobCache.get(track.id);
        if (!url) {
          url = await getTrackPlayableUrl(track, accessToken);
          if (url?.startsWith('blob:')) audioBlobCache.set(track.id, url);
        }
        if (isStale()) return;
        if (!url) throw new Error('無法取得可播放的音訊串流網址');

        audio.src = url;
        audio.playbackRate = playbackRate;
        audio.volume = isMuted ? 0 : volume;

        await audio.play();
        if (isStale()) return;
        setIsPlaying(true);

        if ('mediaSession' in navigator) {
          const icon = (file: string) => `${import.meta.env.BASE_URL}${file}`;
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: 'Easy Audio',
            album: 'Easy Audio',
            artwork: [{ src: icon('icon.jpeg'), sizes: '1024x1024', type: 'image/jpeg' }],
          });
          setPlaybackState('playing');
        }
      } catch (err: any) {
        if (isStale()) return;
        console.error('Play track failed:', err);
        setIsLoadingAudio(false);
        setIsPlaying(false);

        if (err?.name === 'AbortError') return;

        if (err?.name === 'NotAllowedError') {
          setAudioError('瀏覽器擋下了自動播放，請再按一次播放鍵。');
          return;
        }

        if (err?.name === 'NotSupportedError') {
          const src = audio.src;
          setAudioError(GENERIC_LOAD_ERROR);
          diagnoseLoadFailure(src).then((message) => {
            if (audio.src === src) setAudioError(withLoginHint(message, !!accessTokenRef.current));
          });
          return;
        }

        setAudioError(err?.message || UNKNOWN_LOAD_ERROR);
      }
    },
    [playlist, playbackRate, volume, isMuted, accessToken]
  );

  const retry = useCallback(() => {
    if (currentTrack) playTrack(currentTrack);
  }, [currentTrack, playTrack]);

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

  const nextTrack = useCallback(() => {
    if (playlist.length === 0) return;
    playTrack(playlist[(currentTrackIndex + 1) % playlist.length]);
  }, [playlist, currentTrackIndex, playTrack]);

  const prevTrack = useCallback(() => {
    if (playlist.length === 0) return;
    playTrack(playlist[(currentTrackIndex - 1 + playlist.length) % playlist.length]);
  }, [playlist, currentTrackIndex, playTrack]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const seekAndPlay = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio?.src) return;

    audio.currentTime = time;
    setCurrentTime(time);

    if (audio.paused) {
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          setPlaybackState('playing');
        })
        .catch((err) => console.warn('Play after seek failed:', err));
    }
  }, []);

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

  const getTrackAudioBlob = useCallback(
    async (track: AudioTrack): Promise<Blob | null> => {
      const cachedUrl = audioBlobCache.get(track.id);
      if (cachedUrl) {
        const res = await fetch(cachedUrl);
        return await res.blob();
      }

      const playableUrl = await getTrackPlayableUrl(track, accessToken);
      if (!playableUrl) throw new Error('無法取得音檔的下載網址。');

      if (playableUrl.startsWith('blob:')) audioBlobCache.set(track.id, playableUrl);

      let res: Response;
      try {
        res = await fetch(playableUrl);
      } catch {
        const reason = playableUrl.includes('googleapis.com')
          ? await explainMediaUrlError(playableUrl)
          : null;
        throw new Error(withLoginHint(reason ?? '網路連線失敗，無法下載音檔，請確認網路後再試。', !!accessToken));
      }

      if (!res.ok) {
        const reason = await explainMediaUrlError(playableUrl);
        throw new Error(withLoginHint(reason ?? `下載音檔失敗（HTTP ${res.status}）`, !!accessToken));
      }
      return await res.blob();
    },
    [accessToken]
  );

  return {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    volume,
    isMuted,
    isLoadingAudio,
    audioError,
    abRepeat,
    setPlaylist,
    playTrack,
    retry,
    togglePlay,
    nextTrack,
    prevTrack,
    seek,
    seekAndPlay,
    skip,
    changePlaybackRate,
    changeVolume,
    toggleMute,
    setPointA,
    setPointB,
    clearABRepeat,
    getTrackAudioBlob,
  };
}