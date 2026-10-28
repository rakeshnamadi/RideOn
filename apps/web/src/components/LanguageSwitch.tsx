import { Languages } from 'lucide-react';
import { LANGUAGES, useT } from '@/i18n';

export function LanguageSwitch() {
  const { lang, setLang } = useT();
  return (
    <label className="flex items-center gap-1 text-sm text-muted">
      <Languages className="size-4" aria-hidden />
      <span className="sr-only">Language</span>
      <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-full border-0 bg-transparent py-1 pl-1 pr-7 text-sm focus:ring-2 focus:ring-brand-700">
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
