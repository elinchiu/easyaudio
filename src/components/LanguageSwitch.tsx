import React from 'react';
import { Lang, setLang, useLang, useT } from '../lib/i18n';

const OPTIONS: { lang: Lang; label: string }[] = [
  { lang: 'zh', label: '中文' },
  { lang: 'en', label: 'EN' },
];

export const LanguageSwitch: React.FC = () => {
  const current = useLang();
  const t = useT();

  return (
    <div
      role="group"
      aria-label={t('languageAria')}
      className="inline-flex shrink-0 items-center rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-xs font-semibold"
    >
      {OPTIONS.map(({ lang, label }) => {
        const active = lang === current;
        return (
          <button
            key={lang}
            type="button"
            onClick={() => setLang(lang)}
            aria-pressed={active}
            lang={lang === 'zh' ? 'zh-Hant' : 'en'}
            className={`rounded-[10px] px-2 py-1 transition whitespace-nowrap ${
              active ? 'bg-[#495779] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};
