import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT, type MessageKey } from '@/i18n';

/**
 * Two-column frame for sign-in and sign-up. The brand panel restates the positioning
 * and the promise for whichever audience is signing up.
 */
export function AuthShell({ audience = 'all', children }: { audience?: 'all' | 'passenger' | 'driver'; children: ReactNode }) {
  const { t, lang } = useT();
  const promises: { title: MessageKey; body: MessageKey }[] =
    audience === 'driver'
      ? [{ title: 'brand.driverPromise', body: 'auth.driverPitch' }]
      : audience === 'passenger'
        ? [{ title: 'brand.passengerPromise', body: 'auth.passengerPitch' }]
        : [
            { title: 'brand.passengerPromise', body: 'auth.passengerPitch' },
            { title: 'brand.driverPromise', body: 'auth.driverPitch' },
          ];
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_28rem] lg:items-start lg:py-16">
      <aside className="order-2 flex flex-col gap-8 rounded-[2rem] bg-brand-700 p-8 text-paper lg:order-1 lg:min-h-[34rem] lg:p-12">
        <p className={`font-display text-[clamp(2.25rem,4.5vw,3.75rem)] font-extrabold tracking-[-0.03em] ${lang === 'hi' ? 'leading-[1.2]' : 'leading-[0.98]'}`}>
          <span className="block">{t('brand.city')}</span>
          <span className="block">{t('brand.people')}</span>
          <span className="block text-accent-400">{t('brand.ride')}</span>
        </p>
        <ul className="mt-auto flex flex-col gap-5">
          {promises.map((p) => (
            <li key={p.title} className="flex gap-3">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-accent-400 text-ink">
                <Check className="size-4" aria-hidden />
              </span>
              <div>
                <p className="font-semibold">{t(p.title)}</p>
                <p className="text-sm text-brand-200">{t(p.body)}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>
      <div className="order-1 lg:order-2">{children}</div>
    </div>
  );
}
