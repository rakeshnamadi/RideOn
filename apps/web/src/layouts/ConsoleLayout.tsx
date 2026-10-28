import { Bell, LogOut, Menu, X } from 'lucide-react';
import { Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/auth';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { cx, Spinner } from '@/components/ui';
import { useT } from '@/i18n';
import { api } from '@/services/api';
import { useSocketConnected, useSocketEvent } from '@/services/socket';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
  badge?: number;
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 text-ink" aria-label="RideOn home">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="font-display text-xl font-extrabold tracking-tight">RideOn</span>
    </Link>
  );
}

export function NotificationBell({ to }: { to: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () => Number((await api.get<unknown[]>('/notifications', { pageSize: 1 })).meta?.unread ?? 0),
    refetchInterval: 60_000,
  });
  useSocketEvent('notification', () => qc.invalidateQueries({ queryKey: ['notifications'] }));
  const unread = q.data ?? 0;
  return (
    <Link to={to} className="relative rounded-lg p-2 text-stone-600 hover:bg-stone-100" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
      <Bell className="size-5" />
      {unread > 0 && (
        <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

function LiveIndicator() {
  const live = useSocketConnected();
  return (
    <span className="hidden items-center gap-1.5 text-xs text-stone-500 sm:flex" title={live ? 'Live updates connected' : 'Live updates offline — refreshing periodically'}>
      <span className={cx('size-2 rounded-full', live ? 'bg-emerald-500' : 'bg-stone-400')} />
      {live ? 'Live' : 'Polling'}
    </span>
  );
}

/** Sidebar console layout shared by the admin, community and driver consoles (each with its own nav). */
export function ConsoleLayout({ title, nav, header, notificationsTo }: { title: string; nav: NavItem[]; header?: ReactNode; notificationsTo?: string }) {
  const [open, setOpen] = useState(false);
  const { me, logout } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const links = (
    <nav aria-label={`${title} navigation`} className="flex flex-col gap-0.5 p-3">
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cx('flex items-center gap-3 rounded-full px-3.5 py-2 text-sm font-medium', isActive ? 'bg-brand-700 text-white' : 'text-ink/80 hover:bg-sand/70')
          }
        >
          <item.icon className="size-4 shrink-0" />
          <span className="flex-1">{item.label}</span>
          {!!item.badge && <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">{item.badge}</span>}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r border-line bg-white lg:block">
        <div className="sticky top-0">
          <div className="flex h-16 items-center border-b border-line px-5">
            <Logo to="/" />
          </div>
          <p className="px-6 pt-4 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</p>
          {header && <div className="px-3 pt-2">{header}</div>}
          {links}
          <p className="font-display mx-6 mt-4 border-t border-line pt-4 text-sm font-extrabold leading-snug text-brand-700">{t('brand.tagline')}</p>
        </div>
      </aside>
      {open && (
        <div className="fixed inset-0 z-[1100] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-stone-900/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-stone-200 px-4">
              <Logo />
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded p-1 hover:bg-stone-100">
                <X className="size-5" />
              </button>
            </div>
            <p className="px-6 pt-4 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</p>
            {header && <div className="px-3 pt-2">{header}</div>}
            {links}
          </div>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-[900] flex h-16 items-center gap-2 border-b border-line bg-paper/90 px-4 backdrop-blur">
          <button className="rounded-lg p-2 hover:bg-stone-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="font-medium text-stone-700 lg:hidden">{title}</span>
          <div className="ml-auto flex items-center gap-2">
            <LiveIndicator />
            <LanguageSwitch />
            {notificationsTo && <NotificationBell to={notificationsTo} />}
            <span className="hidden text-sm text-stone-600 sm:inline">{me?.name}</span>
            <button
              onClick={async () => {
                await logout();
                navigate('/');
              }}
              className="rounded-lg p-2 text-stone-600 hover:bg-stone-100"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-5" />
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
