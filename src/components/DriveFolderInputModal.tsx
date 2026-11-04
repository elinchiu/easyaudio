import React, { useState } from 'react';
import { extractFolderId } from '../lib/driveApi';
import { Folder, ArrowRight, Sparkles, AlertCircle, X, ExternalLink } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentFolderUrl: string;
  onLoadFolder: (folderUrl: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export const DriveFolderInputModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentFolderUrl,
  onLoadFolder,
  isLoading,
  error,
}) => {
  if (!isOpen) return null;

  const [inputUrl, setInputUrl] = useState(currentFolderUrl);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;
    await onLoadFolder(inputUrl.trim());
  };

  const folderId = extractFolderId(inputUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 p-6 shadow-2xl animate-in zoom-in-95 text-slate-800">
        <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Folder className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">更換 Google Drive 資料夾</h3>
              <p className="text-xs text-slate-500">輸入公開資料夾網址，自動抓取資料夾內的所有音檔</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Google Drive 資料夾網址 (Folder URL 或 ID)：
            </label>
            <input
              type="text"
              placeholder="例如：https://drive.google.com/drive/folders/1J-6Cqy_XamKDEoT2lGp49d-OtP1g9i2m"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white font-mono transition-all"
            />
            {folderId && (
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                <span>辨識出的資料夾 ID：<code className="text-indigo-600 font-bold">{folderId}</code></span>
                <a
                  href={`https://drive.google.com/drive/folders/${folderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700"
                >
                  <span>開啟檢視</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold">載入提示</div>
                <div className="mt-0.5">{error}</div>
              </div>
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs text-slate-600 space-y-1.5">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>自動載入整個資料夾：</span>
            </div>
            <div>• 只要貼上一整包 Google Drive 資料夾連結，網站就會自動檢索並整理出裡面所有的音檔檔名。</div>
            <div>• 支援包含子資料夾中的音檔，不需使用者一首一首複製貼上。</div>
          </div>

          <div className="mt-6 flex justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isLoading || !inputUrl.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-sm active:scale-95 transition"
            >
              {isLoading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>正在讀取資料夾...</span>
                </>
              ) : (
                <>
                  <span>載入整份資料夾音檔</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
