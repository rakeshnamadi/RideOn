import { createContext, useContext, useState, type ReactNode } from 'react';
import { en } from './en';
import { hi } from './hi';
import { te } from './te';

/**
 * Minimal i18n layer. Strings live in per-language dictionaries keyed by English
 * dictionary keys; missing translations fall back to English. Adding a language means
 * adding a dictionary file — no component changes.
 */
export type MessageKey = keyof typeof en;
const DICTIONARIES: Record<string, Partial<Record<MessageKey, string>>> = { en, hi, te };
export const LANGUAGES = [
  { code: 'te', label: 'తెలుగు' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
] as const;

interface I18nValue {
  lang: string;
  setLang: (lang: string) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLang() {
  try {
    return localStorage.getItem('rideon.lang') ?? 'en';
  } catch {
    return 'en';
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(initialLang);
  const setLang = (l: string) => {
    setLangState(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem('rideon.lang', l);
    } catch {
      /* storage may be unavailable */
    }
  };
  const t = (key: MessageKey, vars?: Record<string, string | number>) => {
    let s = DICTIONARIES[lang]?.[key] ?? en[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside I18nProvider');
  return ctx;
}
