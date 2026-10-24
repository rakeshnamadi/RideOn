import { Car, HelpCircle, History, Languages, Users } from 'lucide-react';
import { Suspense } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { homeFor, useAuth } from '@/app/auth';
import { Button, cx, Spinner } from '@/components/ui';
import { LANGUAGES, useT } from '@/i18n';
import { Logo, NotificationBell } from './ConsoleLayout';

function LanguageSwitch() {
  const { lang, setLang } = useT();
  return (
    <label className="flex items-center gap-1 text-sm text-stone-600">
      <Languages className="size-4" aria-hidden />
      <span className="sr-only">Language</span>
      <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded border-0 bg-transparent py-1 pl-1 pr-6 text-sm focus:ring-2 focus:ring-brand-600">
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PublicLayout() {
  const { me } = useAuth();
  const { t } = useT();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Logo />
          <nav className="ml-auto flex items-center gap-1 text-sm sm:gap-3">
            <Link to="/fares" className="rounded px-2 py-1 text-stone-700 hover:bg-stone-100">
              {t('nav.fares')}
            </Link>
            <LanguageSwitch />
            {me ? (
              <Link to={homeFor(me)} className="rounded-lg bg-brand-700 px-3 py-1.5 font-medium text-white hover:bg-brand-800">
                Open app
              </Link>
            ) : (
              <Link to="/login" className="rounded-lg bg-brand-700 px-3 py-1.5 font-medium text-white hover:bg-brand-800">
                {t('nav.signin')}
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="border-t border-stone-200 bg-white py-4 text-center text-xs text-stone-500">
        RideOn — technology for community-governed autos. Map data © OpenStreetMap contributors.
      </footer>
    </div>
  );
}

/** Passenger app: booking-first, mobile bottom navigation. */
export function PassengerLayout() {
  const { t } = useT();
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const tabs = [
    { to: '/app', label: t('nav.book'), icon: Car, end: true },
    { to: '/app/shared', label: t('nav.shared'), icon: Users },
    { to: '/app/bookings', label: t('nav.trips'), icon: History },
    { to: '/app/support', label: t('nav.support'), icon: HelpCircle },
  ];
  return (
    <div className="flex min-h-dvh flex-col pb-16 sm:pb-0">
      <header className="sticky top-0 z-[900] border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Logo to="/app" />
          <nav className="ml-6 hidden gap-1 sm:flex" aria-label="Passenger">
            {tabs.map((tab) => (
              <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => cx('rounded-lg px-3 py-1.5 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-800' : 'text-stone-700 hover:bg-stone-100')}>
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <LanguageSwitch />
            <NotificationBell to="/app/notifications" />
            {me && (me.roles.length > 1) && (
              <Button variant="ghost" size="sm" onClick={() => navigate(homeFor({ ...me, roles: me.roles.filter((r) => r !== 'PASSENGER') }))}>
                Switch console
              </Button>
            )}
            <Link to="/app/profile" className="rounded-lg px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100">
              {t('nav.profile')}
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              {t('nav.signout')}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-[900] grid grid-cols-4 border-t border-stone-200 bg-white sm:hidden" aria-label="Passenger">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-stone-500')}>
            <tab.icon className="size-5" />
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
