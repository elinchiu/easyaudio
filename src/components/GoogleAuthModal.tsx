import React from 'react';
import { ShieldCheck, Music, AlertCircle, X, ArrowRight } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAuthorize: () => Promise<void>;
  isLoading: boolean;
  pendingTrackName?: string | null;
}

export const GoogleAuthModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onAuthorize,
  isLoading,
  pendingTrackName,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-2xl animate-in zoom-in-95 text-slate-800">
        <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">需要 Google 雲端讀取授權</h3>
              <p className="text-xs text-slate-500">保護檔案隱私與解除防盜連限制</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3.5 text-xs text-slate-600 leading-relaxed">
          {pendingTrackName && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 flex items-center gap-2.5">
              <Music className="w-4 h-4 text-indigo-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-indigo-700 font-semibold">即將播放的曲目：</div>
                <div className="text-xs font-bold text-slate-800 truncate">{pendingTrackName}</div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="font-semibold text-slate-800">
              為什麼需要授權？
            </p>
            <p>
              Google 雲端硬碟禁止第三方播放器直接讀取公開檔案（Google 會強制跳轉登入畫面並回傳 HTML，導致瀏覽器播放器崩潰）。
            </p>
            <p>
              只要點擊下方按鈕進行 Google 授權（僅需一次），系統便能透過 Google 官方安全管道取得音檔二進位串流，即可保證 100% 順暢播放、任意快進倒退 3 秒與循環跟讀！
            </p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>此授權僅為<b>唯讀存取 (read-only)</b>，不會修改或刪除您的任何檔案，請安心使用。</span>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
          >
            稍後再說
          </button>
          <button
            type="button"
            onClick={onAuthorize}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-sm active:scale-95 transition"
          >
            {isLoading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>授權中...</span>
              </>
            ) : (
              <>
                <span>立即一鍵授權並播放</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
