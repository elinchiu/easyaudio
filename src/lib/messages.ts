// 所有顯示給使用者的文字都放在這裡。
// - zh 是基準：新增文字時先加在 zh，TypeScript 會強制 en 也要有相同的 key。
// - {name} 是會被替換的參數。
// - 需要單複數的英文，用 { one, other }，由參數 n 決定（n === 1 用 one）。

export type Lang = 'zh' | 'en';

type Plural = { one: string; other: string };
export type Message = string | Plural;

const zh = {
  // ── 網頁標題 / 標頭 ─────────────────────────────
  appTitle: 'Easy Audio - 播放音檔不卡卡',
  appDescription: '播放 Google Drive 音檔的好工具',
  shortcutsHint:
    '空白鍵暫停/播放 · 左右鍵 ±3秒 · Shift + N 下一首 · Shift + P 上一首 · S鍵 開啟/關閉文檔視窗',
  languageAria: '語言 / Language',

  signedIn: '已登入 Google',
  signInTooltip: '只有私人資料夾才需要登入 Google；公開資料夾不用登入',
  signingIn: '登入中...',
  signIn: '登入 Google',

  // ── 匯入資料夾 ─────────────────────────────────
  folderPlaceholder: '貼上資料夾連結',
  folderAria: 'Google Drive 資料夾連結',
  importing: '匯入中...',
  importBtn: '匯入',
  importHelp:
    '請確認 Google Drive 資料夾已設為「知道連結的任何人」可檢視，再貼上連結並按「匯入」。若是非公開資料夾，可登入 Google 後讀取。',
  shareHint: '請確認資料夾（含子資料夾與檔案）的分享設定為「知道連結的任何人 → 檢視者」。',
  privateHint: '若是私人資料夾，請登入 Google 後方可讀取。',
  signInToLoad: '登入 Google 讀取',
  tracksBadge: '{n} 首音檔',
  refresh: '重新整理',
  loading: '讀取中...',
  errSignInCancelled: '登入授權已取消，無法讀取私人資料夾。',
  errFolderLoad: '讀取資料夾失敗，請稍後再試。',

  // ── 頁尾 ───────────────────────────────────────
  termsLink: '服務條款',
  privacyLink: '隱私權政策',
  legalNavAria: '法律資訊',

  // ── 曲目列表 ───────────────────────────────────
  searchPlaceholder: '搜尋...',
  clear: '清除',
  foundCount: '找到 {n} 筆符合',
  totalCount: '共 {n} 首音檔',
  noMatchTitle: '找不到符合條件的音檔',
  noTracksTitle: '尚未載入音檔',
  noMatchDetail: '沒有包含「{query}」的檔案',
  clearSearch: '清除搜尋',
  trackPlay: '播放音檔',
  trackPause: '暫停',

  // ── 播放列 ─────────────────────────────────────
  setPointATitle: '設定循環起點 A',
  setPointBTitle: '設定循環終點 B',
  markerTitle: '{label} 點: {time}',
  expandControls: '展開詳細播放控制',
  transcriptToggle: '音檔文字（開啟 / 收起，快捷鍵: S）',
  transcript: '音檔文字',
  skipBackTitle: '倒退 3 秒 (快捷鍵: ←)',
  prevTitle: '上一首 (快捷鍵: Shift+P)',
  pauseTitle: '暫停 (快捷鍵: 空白鍵)',
  playTitle: '播放 (快捷鍵: 空白鍵)',
  nextTitle: '下一首 (快捷鍵: Shift+N)',
  skipForwardTitle: '快進 3 秒 (快捷鍵: →)',
  speed: '速度:',
  speedTitle: '速度調整',
  clearABTitle: '清除 A-B 循環',
  unmute: '取消靜音',
  mute: '靜音',
  retry: '重試',
  transcriptBtn: 'Script',
  abTitle: 'A-B 區間跟讀循環',
  abNotSet: '尚未設 {label} 點',
  setPoint: '設 {label} 點',

  // ── 文字（逐字稿）面板 ─────────────────────────
  resizePanelAria: '調整文字面板寬度',
  resizePanelTitle: '拖曳調整寬度（雙擊恢復預設）',
  closeTitle: '關閉（Esc）',
  transcribeNoticeTitle: '辨識提示',
  transcribingDefault: '正在辨識音檔...',
  transcribeLocalNote:
    '辨識在瀏覽器裡進行，音檔不會上傳到任何 AI 伺服器。辨識時間會隨音檔長度增加，請保持網頁開啟。',
  cancelTranscribe: '取消辨識',
  preparingTitle: '準備辨識中',
  notTranscribedTitle: '目前音檔尚未轉錄文字',
  queuedNote: '即將開始辨識這一首。',
  idleNote: '點擊下方按鈕辨識此音檔的內容。辨識完成後，點擊任一句就能跳到該處播放。',
  cancel: '取消',
  retranscribe: '重新辨識',
  startTranscribe: '開始辨識',
  transcribeDisclaimer: '• 辨識結果可能有錯字。首次使用需要下載語音辨識模型，建議在 Wi-Fi 下進行。',
  searchTextPlaceholder: '搜尋文字...',
  noTextMatch: '找不到符合搜尋的文字',
  jumpToTime: '跳轉至此時間點播放',
  clickToJump: '點擊任意句子即可直接跳轉',

  // ── 播放錯誤（useAudioPlayer）──────────────────
  loadErrorChecking: '音檔載入失敗，正在確認原因，請稍後...',
  loadErrorUnknown:
    'Google Drive 有回應，但音檔還是播不出來，可能是網路不穩、暫時無回應，或音檔格式瀏覽器無法解碼。請重整網頁後再試。',
  loginHintSuffix: '若是私人檔案，請登入 Google 後方可讀取。',
  errNoStreamUrl: '無法取得可播放的音訊串流網址',
  errAutoplayBlocked: '瀏覽器擋下了自動播放，請再按一次播放鍵。',
  errNoDownloadUrl: '無法取得音檔的下載網址。',
  errNetworkDownload: '網路連線失敗，無法下載音檔，請確認網路後再試。',
  errDownloadFailed: '下載音檔失敗（HTTP {status}）',

  // ── 辨識佇列（useTranscriptionQueue）───────────
  progressReadingAudio: '正在讀取音訊檔...',
  errNoAudioContent: '無法取得音檔內容，請稍後再試。',
  errTranscribeFailed: '辨識失敗，請稍後再試。',
  transcribeCancelled: '已取消辨識',

  // ── Google Drive（driveApi）────────────────────
  subjectFolder: '資料夾',
  subjectFile: '音檔',
  detailSep: '：',
  googleResponse: '（Google 回應：{detail}）',
  errApiKeyRestricted:
    'API Key 的「API 限制」沒有包含 Google Drive API，請到 Cloud Console 勾選。{raw}',
  errReferrerBlocked:
    'API Key 的網站來源（HTTP referrer）限制沒有包含目前的網域，請到 Google Cloud Console 加入。',
  errApiDisabled: 'Google Cloud 專案尚未啟用 Google Drive API，請先啟用。',
  errKeyInvalid: 'API Key 無效，請檢查 VITE_GOOGLE_API_KEY 是否正確。',
  errRateLimit: 'Google Drive 請求過於頻繁，請稍後再試。',
  errDownloadQuota: '這個{subject}的下載流量已達 Google 的上限，請稍後再試。{raw}',
  errNotFoundSignedIn: '找不到此{subject}，請確認網址是否正確。',
  errNotFoundPublic:
    '找不到此{subject}。請確認網址正確，且{subject}分享設定為「知道連結的任何人 → 檢視者」。',
  errNoPermission: '沒有權限存取此{subject}。{raw}',
  errCannotRead:
    '無法讀取此{subject}。請確認{subject}分享設定為「知道連結的任何人 → 檢視者」。{raw}',
  errReadFailed: '無法讀取{subject} (代碼 {status}){detail}',
  errNoApiKey: '尚未設定 API Key（VITE_GOOGLE_API_KEY），無法讀取公開資料夾。',
  errFolderNotPublic: '這個資料夾不是公開的。',
  errFolderNotFoundSignedIn:
    '找不到此資料夾，請確認網址是否正確，以及目前登入的 Google 帳號有權限存取。',
  mediaBlocked:
    'Google 暫時拒絕了這個音檔的下載（常見原因：Google 偵測到大量自動化請求，或這個檔案的下載流量已達上限）。請稍等一段時間，或換個網路（例如關閉 VPN、改用行動網路）後再試。',
  errCannotReachDrive: '無法連線到 Google Drive，請確認網路連線後再試。',

  // ── 登入（firebase）────────────────────────────
  errNoToken: '無法取得 Google 雲端授權存取 Token',

  // ── 語音辨識（whisper）─────────────────────────
  modelSizeIos: '約 80–100MB',
  modelSizeDefault: '約 250–290MB',
  errNoAudioContext: '您的瀏覽器不支援 AudioContext 音訊解碼',
  errDecodeFailed: '音訊解碼失敗：{reason}',
  unknownAudioFormat: '無法解析音訊格式',
  errBusy: '已有另一個辨識正在進行中',
  errWorkerCreate: '無法建立 Whisper Worker：{reason}',
  progressModelLoading: '模型下載完成，正在載入模型...',
  progressModelDownloading: '正在下載語音辨識模型 {percent}%',
  progressTranscribing: '正在辨識音檔內容...',
  errWhisper: 'Whisper 辨識錯誤',
  errWorkerNoModel: '沒有指定 Whisper 模型',
  errWorkerNoAudio: '沒有收到音訊資料',
  errWorkerLoad: 'Whisper Worker 載入失敗（{where}）',
  workerFileMissing: '找不到 Worker 檔案，請到 DevTools 的 Network 分頁檢查',
  errWorkerMessage: 'Worker 訊息傳遞失敗',
  errWorkerSend: '無法傳送音訊給 Worker：{reason}',
  progressConverting: '正在轉換音訊格式（16kHz 單聲道）...',
  errEmptyDecoded: '音檔解碼後是空的，無法辨識。',
  progressPreparingModel:
    '正在準備語音辨識模型（{size}，首次使用需下載，之後會保存在瀏覽器中）...',
  progressDone: '轉錄完成！',
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, Message> = {
  // ── Page title / header ─────────────────────────
  appTitle: 'Easy Audio - Smooth audio playback',
  appDescription: 'A handy tool for playing audio files from Google Drive',
  shortcutsHint:
    'Space: play/pause · ←/→: ±3s · Shift + N: next · Shift + P: previous · S: toggle transcript',
  languageAria: '語言 / Language',

  signedIn: 'Signed in with Google',
  signInTooltip: 'Signing in is only needed for private folders; public folders work without it',
  signingIn: 'Signing in...',
  signIn: 'Sign in with Google',

  // ── Import a folder ─────────────────────────────
  folderPlaceholder: 'Paste folder link',
  folderAria: 'Google Drive folder link',
  importing: 'Importing...',
  importBtn: 'Import',
  importHelp:
    'Make sure the Google Drive folder is set so that “Anyone with the link” can view it, then paste the link and click “Import”. If the folder is private, sign in with Google to read it.',
  shareHint:
    'Make sure the folder (including subfolders and files) is shared as “Anyone with the link → Viewer”.',
  privateHint: 'If this is a private folder, sign in with Google to read it.',
  signInToLoad: 'Sign in with Google to load',
  tracksBadge: { one: '{n} audio file', other: '{n} audio files' },
  refresh: 'Refresh',
  loading: 'Loading...',
  errSignInCancelled: 'Sign-in was cancelled, so the private folder could not be read.',
  errFolderLoad: 'Failed to read the folder. Please try again later.',

  // ── Footer ──────────────────────────────────────
  termsLink: 'Terms',
  privacyLink: 'Privacy Policy',
  legalNavAria: 'Legal information',

  // ── Track list ──────────────────────────────────
  searchPlaceholder: 'Search...',
  clear: 'Clear',
  foundCount: { one: '{n} match', other: '{n} matches' },
  totalCount: { one: '{n} audio file', other: '{n} audio files' },
  noMatchTitle: 'No matching audio files',
  noTracksTitle: 'No audio files loaded yet',
  noMatchDetail: 'No files contain “{query}”',
  clearSearch: 'Clear search',
  trackPlay: 'Play',
  trackPause: 'Pause',

  // ── Player bar ──────────────────────────────────
  setPointATitle: 'Set loop start (A)',
  setPointBTitle: 'Set loop end (B)',
  markerTitle: 'Point {label}: {time}',
  expandControls: 'Show full player controls',
  transcriptToggle: 'Transcript (open / close, shortcut: S)',
  transcript: 'Transcript',
  skipBackTitle: 'Back 3 seconds (shortcut: ←)',
  prevTitle: 'Previous (shortcut: Shift+P)',
  pauseTitle: 'Pause (shortcut: Space)',
  playTitle: 'Play (shortcut: Space)',
  nextTitle: 'Next (shortcut: Shift+N)',
  skipForwardTitle: 'Forward 3 seconds (shortcut: →)',
  speed: 'Speed:',
  speedTitle: 'Playback speed',
  clearABTitle: 'Clear A-B loop',
  unmute: 'Unmute',
  mute: 'Mute',
  retry: 'Retry',
  transcriptBtn: 'Transcript',
  abTitle: 'A-B loop for shadowing practice',
  abNotSet: '{label} not set',
  setPoint: 'Set {label}',

  // ── Transcript panel ────────────────────────────
  resizePanelAria: 'Resize transcript panel',
  resizePanelTitle: 'Drag to resize (double-click to reset)',
  closeTitle: 'Close (Esc)',
  transcribeNoticeTitle: 'Transcription notice',
  transcribingDefault: 'Transcribing the audio...',
  transcribeLocalNote:
    'Transcription runs in your browser, and your audio is never uploaded to any AI server. Longer files take longer, so please keep this page open.',
  cancelTranscribe: 'Cancel transcription',
  preparingTitle: 'Getting ready to transcribe',
  notTranscribedTitle: 'This audio has not been transcribed yet',
  queuedNote: 'Transcription of this track will start shortly.',
  idleNote:
    'Click the button below to transcribe this audio. Once it is done, click any sentence to jump to that point and play.',
  cancel: 'Cancel',
  retranscribe: 'Transcribe again',
  startTranscribe: 'Start transcription',
  transcribeDisclaimer:
    '• Results may contain errors. The first use downloads a speech recognition model, so Wi-Fi is recommended.',
  searchTextPlaceholder: 'Search text...',
  noTextMatch: 'No text matches your search',
  jumpToTime: 'Jump to this time and play',
  clickToJump: 'Click any sentence to jump straight to it',

  // ── Playback errors (useAudioPlayer) ────────────
  loadErrorChecking: 'Failed to load the audio. Checking the cause, please wait...',
  loadErrorUnknown:
    'Google Drive responded, but the audio still cannot be played. The network may be unstable, the server may be temporarily unresponsive, or your browser may not be able to decode this audio format. Please reload the page and try again.',
  loginHintSuffix: 'If this is a private file, sign in with Google to read it.',
  errNoStreamUrl: 'Could not get a playable audio stream URL.',
  errAutoplayBlocked: 'The browser blocked autoplay. Please press play again.',
  errNoDownloadUrl: 'Could not get the download URL for this audio file.',
  errNetworkDownload:
    'Network error: the audio could not be downloaded. Please check your connection and try again.',
  errDownloadFailed: 'Failed to download the audio (HTTP {status})',

  // ── Transcription queue ─────────────────────────
  progressReadingAudio: 'Reading the audio file...',
  errNoAudioContent: 'Could not get the audio content. Please try again later.',
  errTranscribeFailed: 'Transcription failed. Please try again later.',
  transcribeCancelled: 'Transcription cancelled',

  // ── Google Drive (driveApi) ─────────────────────
  subjectFolder: 'folder',
  subjectFile: 'audio file',
  detailSep: ': ',
  googleResponse: ' (Google response: {detail})',
  errApiKeyRestricted:
    'The “API restrictions” of the API key do not include the Google Drive API. Please enable it in the Cloud Console.{raw}',
  errReferrerBlocked:
    'The website (HTTP referrer) restrictions of the API key do not include the current domain. Please add it in the Google Cloud Console.',
  errApiDisabled: 'The Google Drive API is not enabled for the Google Cloud project. Please enable it first.',
  errKeyInvalid: 'The API key is invalid. Please check that VITE_GOOGLE_API_KEY is correct.',
  errRateLimit: 'Too many requests to Google Drive. Please try again later.',
  errDownloadQuota:
    'The download quota for this {subject} has been reached on Google’s side. Please try again later.{raw}',
  errNotFoundSignedIn: 'This {subject} was not found. Please check that the link is correct.',
  errNotFoundPublic:
    'This {subject} was not found. Please check that the link is correct and that it is shared as “Anyone with the link → Viewer”.',
  errNoPermission: 'You do not have permission to access this {subject}.{raw}',
  errCannotRead:
    'This {subject} could not be read. Please make sure it is shared as “Anyone with the link → Viewer”.{raw}',
  errReadFailed: 'Could not read the {subject} (code {status}){detail}',
  errNoApiKey: 'No API key is configured (VITE_GOOGLE_API_KEY), so public folders cannot be read.',
  errFolderNotPublic: 'This folder is not public.',
  errFolderNotFoundSignedIn:
    'This folder was not found. Please check that the link is correct and that the signed-in Google account has access to it.',
  mediaBlocked:
    'Google has temporarily blocked downloading this audio file (common causes: Google detected a large number of automated requests, or this file has reached its download quota). Please wait a while, or switch networks (for example, turn off your VPN or use mobile data) and try again.',
  errCannotReachDrive: 'Could not connect to Google Drive. Please check your network connection and try again.',

  // ── Sign-in (firebase) ──────────────────────────
  errNoToken: 'Could not get the Google Drive access token.',

  // ── Speech recognition (whisper) ────────────────
  modelSizeIos: 'about 80–100 MB',
  modelSizeDefault: 'about 250–290 MB',
  errNoAudioContext: 'Your browser does not support AudioContext audio decoding.',
  errDecodeFailed: 'Audio decoding failed: {reason}',
  unknownAudioFormat: 'unrecognized audio format',
  errBusy: 'Another transcription is already in progress.',
  errWorkerCreate: 'Could not create the Whisper worker: {reason}',
  progressModelLoading: 'Model downloaded. Loading the model...',
  progressModelDownloading: 'Downloading the speech recognition model {percent}%',
  progressTranscribing: 'Transcribing the audio...',
  errWhisper: 'Whisper transcription error',
  errWorkerNoModel: 'No Whisper model was specified.',
  errWorkerNoAudio: 'No audio data was received.',
  errWorkerLoad: 'Failed to load the Whisper worker ({where})',
  workerFileMissing: 'worker file not found; check the Network tab in DevTools',
  errWorkerMessage: 'Worker message passing failed.',
  errWorkerSend: 'Could not send the audio to the worker: {reason}',
  progressConverting: 'Converting the audio format (16 kHz mono)...',
  errEmptyDecoded: 'The decoded audio is empty and cannot be transcribed.',
  progressPreparingModel:
    'Preparing the speech recognition model ({size}; downloaded on first use, then kept in your browser)...',
  progressDone: 'Transcription complete!',
};

export const messages: Record<Lang, Record<MessageKey, Message>> = { zh, en };
