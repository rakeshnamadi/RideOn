import { Car, HelpCircle, History, Users } from 'lucide-react';
import { Suspense, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { homeFor, useAuth } from '@/app/auth';
import { Button, cx, Spinner } from '@/components/ui';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { useT } from '@/i18n';
import { Logo, NotificationBell } from './ConsoleLayout';

export function PublicLayout() {
  const { me } = useAuth();
  const { t } = useT();
  const { hash, pathname } = useLocation();
  // In-page anchors (/#drivers) — scroll once the target section has rendered.
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    const id = hash.slice(1);
    let tries = 0;
    const tick = () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (tries++ < 20) setTimeout(tick, 100);
    };
    tick();
  }, [hash, pathname]);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-[900] border-b border-line/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="ml-auto flex items-center gap-1 text-sm font-medium sm:gap-2" aria-label="Main">
            <Link to="/#passengers" className="hidden rounded-full px-3 py-2 text-ink/80 hover:bg-sand/70 md:inline">
              {t('home.navPassengers')}
            </Link>
            <Link to="/#drivers" className="hidden rounded-full px-3 py-2 text-ink/80 hover:bg-sand/70 md:inline">
              {t('home.navDrivers')}
            </Link>
            <Link to="/fares" className="hidden rounded-full px-3 py-2 text-ink/80 hover:bg-sand/70 sm:inline">
              {t('nav.fares')}
            </Link>
            <LanguageSwitch />
            {me ? (
              <Link to={homeFor(me)} className="whitespace-nowrap rounded-full bg-ink px-4 py-2 font-semibold text-paper hover:bg-brand-800">
                {t('home.openApp')}
              </Link>
            ) : (
              <Link to="/login" className="whitespace-nowrap rounded-full bg-ink px-4 py-2 font-semibold text-paper hover:bg-brand-800">
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
      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
          <span>
            <span className="font-display font-extrabold text-ink">{t('brand.tagline')}</span> · {t('home.footerAbout')}
          </span>
          <span>{t('home.footerLegal')}</span>
        </div>
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
      <header className="sticky top-0 z-[900] border-b border-line/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <Logo to="/app" />
          <nav className="ml-6 hidden gap-1 sm:flex" aria-label="Passenger">
            {tabs.map((tab) => (
              <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => cx('rounded-full px-3.5 py-2 text-sm font-medium', isActive ? 'bg-ink text-paper' : 'text-ink/80 hover:bg-sand/70')}>
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <LanguageSwitch />
            <NotificationBell to="/app/notifications" />
            {me && me.roles.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => navigate(homeFor({ ...me, roles: me.roles.filter((r) => r !== 'PASSENGER') }))}>
                {t('nav.switchConsole')}
              </Button>
            )}
            <Link to="/app/profile" className="hidden rounded-full px-3 py-2 text-sm text-ink/80 hover:bg-sand/70 sm:inline">
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
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-[900] grid grid-cols-4 border-t border-line bg-white sm:hidden" aria-label="Passenger">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-muted')}>
            <tab.icon className="size-5" />
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
