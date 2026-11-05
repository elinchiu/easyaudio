import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// 是否已安裝（以主畫面 App 的方式開啟）
const checkStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(checkStandalone);
  const [isIOS] = useState(() => /iphone|ipad|ipod/i.test(navigator.userAgent));

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault(); // 擋掉瀏覽器預設的安裝提示，改由自己的按鈕觸發
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  /** 跳出安裝視窗；使用者按下安裝回傳 true */
  const install = async () => {
    if (!deferredPrompt) return false;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome !== 'accepted') return false;

    setIsInstalled(true);
    setDeferredPrompt(null);
    return true;
  };

  return { isInstallable: !!deferredPrompt, isInstalled, isIOS, install };
}