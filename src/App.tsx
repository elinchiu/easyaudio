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
  Headphones, 
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
  const [folderName, setFolderName] = useState<string>('課本音檔資料夾');
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
    if (trackChanged && d ===
