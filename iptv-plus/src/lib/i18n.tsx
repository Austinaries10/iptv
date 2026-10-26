'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * 中英双语：界面文案就地写成 `t('中文', 'English')`，无需维护键值字典，
 * 新增文案时两种语言并排出现，不会漏翻。语言保存在 localStorage，
 * 首次访问按浏览器语言决定（中文浏览器默认中文，其余默认英文）。
 */

export type Lang = 'zh' | 'en';
export const LANG_STORAGE_KEY = 'iptv-plus-lang';

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (zh: string, en: string) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: 'zh',
  setLang: () => {},
  t: (zh) => zh,
});

export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {
    /* 存储不可用：按浏览器语言 */
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh');

  useEffect(() => {
    const detected = detectLang();
    setLangState(detected);
    document.documentElement.lang = detected === 'zh' ? 'zh-CN' : 'en';
  }, []);

  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      /* 仅本次会话生效 */
    }
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
    setLangState(next);
  }, []);

  const t = useCallback((zh: string, en: string) => (lang === 'zh' ? zh : en), [lang]);

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}

/** 只取翻译函数的简写 */
export function useT(): LangContextValue['t'] {
  return useContext(LangContext).t;
}
