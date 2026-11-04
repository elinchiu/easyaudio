import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Smartphone, Download, Share, PlusSquare, X } from 'lucide-react';

interface Props {
  variant?: 'button' | 'banner';
}

export const PWAInstallButton: React.FC<Props> = ({ variant = 'button' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // If already running inside standalone app mode, hide install UI
  if (isInstalled) {
    return null;
  }

  // If banner was dismissed in this session
  if (variant === 'banner' && bannerDismissed) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else if (isIOS) {
      setShowIOSGuide(true);
    } else {
      setShowIOSGuide(true);
    }
  };

  if (variant === 'banner') {
    return (
      <>
        <div className="bg-gradient-to-r from-indigo-50 via-sky-50 to-indigo-50 border-b border-indigo-100 px-4 py-2 text-xs sm:text-sm text-indigo-900 flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 shadow-xs">
              <Smartphone className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="truncate">
              <span className="font-bold text-indigo-950">安裝為手機 App：</span>
              <span className="hidden sm:inline text-indigo-700"> 加到手機桌面，隨點即聽！</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleInstallClick}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-semibold px-3 py-1.5 rounded-lg transition-all shadow-xs text-xs"
            >
              <Download className="w-3 h-3" />
              <span>安裝 App</span>
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              className="text-slate-400 hover:text-slate-700 p-1 rounded-md"
              title="關閉提示"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Modal Guide */}
        {showIOSGuide && (
          <IOSInstallModal onClose={() => setShowIOSGuide(false)} isIOS={isIOS} />
        )}
      </>
    );
  }

  // Variant === 'button'
  return (
    <>
      <button
        onClick={handleInstallClick}
        className="flex items-center gap-1.5 text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 px-3 py-1.5 rounded-xl active:scale-95 transition-all shadow-xs"
        title="安裝至手機或電腦桌面"
      >
        <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
        <span className="hidden sm:inline">安裝 App</span>
        <span className="sm:hidden">安裝</span>
      </button>

      {showIOSGuide && (
        <IOSInstallModal onClose={() => setShowIOSGuide(false)} isIOS={isIOS} />
      )}
    </>
  );
};

const IOSInstallModal: React.FC<{ onClose: () => void; isIOS: boolean }> = ({ onClose, isIOS }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-6 shadow-2xl animate-in fade-in zoom-in-95 text-slate-800">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Smartphone className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-slate-800">
              {isIOS ? '在 iPhone / iPad 上安裝' : '在手機上下載/安裝 App'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3.5 text-xs text-slate-600">
          {isIOS ? (
            <>
              <p className="text-slate-500">
                透過 Safari 瀏覽器加到手機桌面，享受獨立 App 體驗：
              </p>
              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200/70">
                <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                  <Share className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-800">步驟 1：點擊分享按鈕</div>
                  <div className="text-slate-500 mt-0.5">
                    在 Safari 底部工具列點擊「分享」圖示
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200/70">
                <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                  <PlusSquare className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-800">步驟 2：加入主畫面</div>
                  <div className="text-slate-500 mt-0.5">
                    向下滑動選單並點選「加入主畫面」(Add to Home Screen)
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-slate-500">
                您可以透過瀏覽器將本應用程式安裝至手機桌面：
              </p>
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/70 space-y-2 text-xs">
                <div>
                  <strong>Chrome / Edge：</strong>點選右上角選單「⋮」，選擇「安裝應用程式」或「加到主畫面」。
                </div>
                <div>
                  <strong>桌面電腦：</strong>點擊網址列右側的「安裝」圖示即可。
                </div>
              </div>
            </>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 active:scale-95 transition-all shadow-sm"
        >
          我知道了
        </button>
      </div>
    </div>
  );
};
