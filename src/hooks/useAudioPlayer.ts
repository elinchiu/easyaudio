import { useState, useEffect, useRef, useCallback } from 'react';
import { AudioTrack, RepeatMode, ABRepeat } from '../types/track';
import { getTrackPlayableUrl, explainMediaUrlError } from '../lib/driveApi';

// 記憶體快取：已下載成 blob 的音檔網址，避免重複下載
const audioBlobCache = new Map<string, string>();

// 預設的循環模式：一般播放（播完就停止，不自動播下一首）。
// 這個值必須是 RepeatMode 裡代表「一般播放」的那個字串；
// 如果你的 types/track.ts 用的不是 'off'（例如 'none' 或 'normal'），只要改這一行。
const DEFAULT_REPEAT_MODE: RepeatMode = 'off' as RepeatMode;

// 還沒查出真正原因之前先顯示的暫時訊息（查到後會被取代）
const GENERIC_LOAD_ERROR = '音檔載入失敗，正在確認原因，請稍後...';

// Google 回應正常、卻還是播不出來時的說明（多半是暫時性問題）
const UNKNOWN_LOAD_ERROR =
  'Google Drive 有回應，但音檔還是播不出來，可能是網路不穩、暫時無回應，或音檔格式瀏覽器無法解碼。請重整網頁後再試。';

/**
 * 只有「確定是權限問題」而且「還沒登入」時，才提示私人檔案可以登入 Google。
 * 流量上限、API Key 設定、網路不穩等其他原因都不會出現這句，公開資料夾也就不會被要求登入。
 */
function withLoginHint(message: string, hasToken: boolean): string {
  if (hasToken) return message;
  if (!/分享設定|沒有權限|找不到此/.test(message)) return message;
  return `${message} 若是私人檔案，請登入 Google 後方可讀取。`;
}

const setPlaybackState = (state: MediaSessionPlaybackState) => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
};

// 同一個網址短時間內只向 Google 查一次原因（<audio> 的 error 事件與 play() 失敗常常同時發生）
const diagnosisCache = new Map<string, Promise<string>>();

/**
 * 播放失敗後，向 Google 查出真正的原因（<audio> 本身看不到錯誤內容）。
 * 一定會回傳一段訊息：查得到就是具體原因，查不到就是通用說明。
 */
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

// _onRequestAuth 保留參數以維持相容；公開資料夾不再需要它
export function useAudioPlayer(accessToken?: string | null, _onRequestAuth?: () => void) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 讓 audio 的 ended 事件永遠呼叫最新版本的 handleTrackEnd（避免拿到舊的空 playlist）
  const handleTrackEndRef = useRef<() => void>(() => {});

  // 每次 playTrack 都會領一個新的編號；快速連點切歌時，舊的請求回來後發現自己過期就直接放棄
  const playRequestRef = useRef(0);

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

  // 讓只建立一次的 audio 事件處理函式也能讀到最新的登入狀態
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  
  const currentTrack = playlist[currentTrackIndex] || null;

  // 建立 Audio 元素（只建立一次）
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);

      // 長度被低估：沒有長度標頭的 MP3，瀏覽器一開始只能用檔案大小估算長度，常常偏短。
      // 播放位置已經超過 duration 時，把總長度往後延，畫面才不會出現「播放秒數 > 總秒數」。
      // 真正的長度出來時（durationchange）會再修正成正確的值。
      if (Number.isFinite(audio.duration) && audio.currentTime > audio.duration) {
        setDuration(audio.currentTime);
      }

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
    // 瀏覽器分析完整個檔案、算出更準確的長度時會觸發（只聽 loadedmetadata 會一直停在最初的估算值）
    const onDurationChange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onEnded = () => handleTrackEndRef.current();
    const onError = () => {
      // 沒有音源（例如剛清掉 src）時也會觸發 error，這不是真的失敗
      if (!audio.getAttribute('src')) return;

      setIsLoadingAudio(false);
      setIsPlaying(false);
      setAudioError(GENERIC_LOAD_ERROR);

      // 向 Google 查出真正的原因（例如 403、流量上限、API Key 設定），再換掉暫時訊息
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

  // 載入並播放指定音檔
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
        // 1. 記憶體快取有就直接用
        // 2. 否則由 driveApi 決定：已登入用 Bearer token 下載（可播私人檔案），
        //    未登入（或 token 已過期）直接用 Drive API + API Key 的公開串流網址
        let url = audioBlobCache.get(track.id);
        if (!url) {
          url = await getTrackPlayableUrl(track, accessToken);
          if (url?.startsWith('blob:')) audioBlobCache.set(track.id, url);
        }
        if (isStale()) return; // 使用者已經切到別首，這一首不用播了
        if (!url) throw new Error('無法取得可播放的音訊串流網址');

        audio.src = url;
        audio.playbackRate = playbackRate;
        audio.volume = isMuted ? 0 : volume;

        await audio.play();
        if (isStale()) return;
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
        if (isStale()) return;
        console.error('Play track failed:', err);
        setIsLoadingAudio(false);
        setIsPlaying(false);

        // 被新的載入或暫停打斷，不是真的錯誤
        if (err?.name === 'AbortError') return;

        if (err?.name === 'NotAllowedError') {
          setAudioError('瀏覽器擋下了自動播放，請再按一次播放鍵。');
          return;
        }

        if (err?.name === 'NotSupportedError') {
          // 瀏覽器只會說 "no supported source was found"，真正原因要向 Google 查
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

  // 重新載入並播放目前這一首（播放失敗後按「重試」）
  const retry = useCallback(() => {
    if (currentTrack) playTrack(currentTrack);
  }, [currentTrack, playTrack]);

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

  // 跳到指定秒數並直接播放（暫停中也會自動開始播）
  // 給文字面板用：點哪一句就從那一句開始播
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
  // 失敗時會丟出帶有「真正原因」的錯誤（辨識面板直接顯示這段訊息），不再只回傳 null
  const getTrackAudioBlob = useCallback(
    async (track: AudioTrack): Promise<Blob | null> => {
      // 1. 已經有記憶體快取的 blob 網址（播放過、或之前下載過）就直接用
      const cachedUrl = audioBlobCache.get(track.id);
      if (cachedUrl) {
        const res = await fetch(cachedUrl);
        return await res.blob();
      }

      // 2. 否則透過 driveApi 取得可播放網址並下載
      const playableUrl = await getTrackPlayableUrl(track, accessToken);
      if (!playableUrl) throw new Error('無法取得音檔的下載網址。');

      // 已登入時 driveApi 會回傳 blob: 網址，存進快取，之後播放這一首就不用再下載一次
      if (playableUrl.startsWith('blob:')) audioBlobCache.set(track.id, playableUrl);

      let res: Response;
      try {
        res = await fetch(playableUrl);
      } catch {
        // fetch 丟錯不一定是網路問題（Google 擋下請求時回應沒有 CORS 標頭，也會走到這裡），先查出真正原因
        const reason = playableUrl.includes('googleapis.com')
          ? await explainMediaUrlError(playableUrl)
          : null;
        throw new Error(withLoginHint(reason ?? '網路連線失敗，無法下載音檔，請確認網路後再試。', !!accessToken));
      }

      if (!res.ok) {
        // 向 Google 查出真正的原因；只有確定是權限問題且還沒登入時，才會提示私人檔案可以登入
        const reason = await explainMediaUrlError(playableUrl);
        throw new Error(withLoginHint(reason ?? `下載音檔失敗（HTTP ${res.status}）`, !!accessToken));
      }
      return await res.blob();
    },
    [accessToken]
  );

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
    retry,
    togglePlay,
    nextTrack,
    prevTrack,
    seek,
    seekAndPlay,
    skip,
    changePlaybackRate,
    setRepeatMode,
    changeVolume,
    toggleMute,
    setPointA,
    setPointB,
    clearABRepeat,
    getTrackAudioBlob,
  };
}