import React from 'react';
import { Moon, Clock, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentMinutes: number | null;
  secondsLeft: number | null;
  onSetTimer: (minutes: number | null) => void;
}

export const SleepTimerModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentMinutes,
  secondsLeft,
  onSetTimer,
}) => {
  if (!isOpen) return null;

  const timerOptions = [10, 15, 20, 30, 45, 60];

  const formatRemaining = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m} 分 ${s.toString().padStart(2, '0')} 秒`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-5 shadow-2xl animate-in fade-in zoom-in-95 text-slate-800">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Moon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">定時睡眠關閉 (Sleep Timer)</h3>
              <p className="text-xs text-slate-500">設定時間倒數結束後自動暫停播放</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {secondsLeft !== null && secondsLeft > 0 && (
          <div className="my-4 bg-indigo-50 border border-indigo-100 rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-indigo-900 text-xs font-medium">
              <Clock className="w-4 h-4 animate-spin text-indigo-600" />
              <span>剩餘播放時間：{formatRemaining(secondsLeft)}</span>
            </div>
            <button
              onClick={() => {
                onSetTimer(null);
                onClose();
              }}
              className="text-xs text-rose-600 hover:text-rose-700 font-semibold"
            >
              取消定時
            </button>
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          {timerOptions.map((min) => (
            <button
              key={min}
              onClick={() => {
                onSetTimer(min);
                onClose();
              }}
              className={`py-2.5 rounded-xl text-xs font-semibold border transition-all active:scale-95 ${
                currentMinutes === min
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {min} 分鐘
            </button>
          ))}
        </div>

        <div className="mt-4 flex justify-between items-center pt-3 border-t border-slate-100 text-xs">
          <button
            onClick={() => {
              onSetTimer(null);
              onClose();
            }}
            className="text-slate-500 hover:text-slate-800"
          >
            關閉定時功能
          </button>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
