import { useEffect, useState } from 'react';

/** 回傳目前是否有網路連線，斷線或恢復時會自動更新 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return isOnline;
}