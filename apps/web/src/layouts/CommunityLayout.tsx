import { BarChart3, Bus, CalendarClock, Car, ClipboardCheck, FileText, Gauge, IdCard, IndianRupee, ListOrdered, Map, MapPin, Megaphone, MessageSquareWarning, Settings, ShieldCheck } from 'lucide-react';
import { createContext, useContext } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/app/auth';
import { Spinner, ErrorState } from '@/components/ui';
import { useApi } from '@/hooks/api';
import { ConsoleLayout, type NavItem } from './ConsoleLayout';

export interface CommunityConsole {
  community: { id: string; name: string; status: string; city: { name: string; timezone: string }; centerLat: number; centerLng: number; policy: Record<string, unknown> | null } & Record<string, unknown>;
  permissions: string[];
  counts: { pendingMembers: number; pendingVehicles: number; openComplaints: number; pendingProposals: number; onlineDrivers: number };
}

const CommunityContext = createContext<CommunityConsole | null>(null);

/** Current community + the caller's permissions in it (from the API, not guessed client-side). */
export function useCommunity() {
  const ctx = useContext(CommunityContext);
  if (!ctx) throw new Error('useCommunity must be used inside CommunityLayout');
  return { ...ctx, id: ctx.community.id, can: (perm: string) => ctx.permissions.includes(`community.${perm}`) };
}

function CommunitySwitcher() {
  const { me } = useAuth();
  const { communityId } = useParams();
  const navigate = useNavigate();
  if (!me || me.communities.length < 2) return null;
  return (
    <label className="block px-3 pb-1 text-xs text-stone-500">
      Community
      <select value={communityId} onChange={(e) => navigate(`/community/${e.target.value}`)} className="mt-1 block w-full rounded-lg border-0 text-sm ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-600">
        {me.communities.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CommunityLayout() {
  const { communityId } = useParams();
  const q = useApi<CommunityConsole>(['community', communityId, 'console'], `/communities/${communityId}/console`, undefined, { refetchInterval: 60_000 });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const base = `/community/${communityId}`;
  const can = (p: string) => q.data!.permissions.includes(`community.${p}`);
  const c = q.data.counts;
  const nav: (NavItem & { perm?: string })[] = [
    { to: base, label: 'Overview', icon: Gauge, end: true },
    { to: `${base}/members`, label: 'Applications', icon: ClipboardCheck, perm: 'members.manage', badge: c.pendingMembers },
    { to: `${base}/drivers`, label: 'Drivers', icon: IdCard, perm: 'drivers.manage' },
    { to: `${base}/vehicles`, label: 'Vehicles', icon: Car, perm: 'vehicles.manage', badge: c.pendingVehicles },
    { to: `${base}/queue`, label: 'Live queue', icon: ListOrdered, perm: 'queue.manage' },
    { to: `${base}/areas`, label: 'Service areas', icon: Map, perm: 'view' },
    { to: `${base}/pickup-points`, label: 'Stands & stops', icon: MapPin, perm: 'view' },
    { to: `${base}/routes`, label: 'Shared routes', icon: Bus, perm: 'view' },
    { to: `${base}/departures`, label: 'Departures', icon: CalendarClock, perm: 'bookings.view' },
    { to: `${base}/fares`, label: 'Fares & governance', icon: IndianRupee, perm: 'view', badge: c.pendingProposals },
    { to: `${base}/bookings`, label: 'Bookings', icon: BarChart3, perm: 'bookings.view' },
    { to: `${base}/complaints`, label: 'Complaints & appeals', icon: MessageSquareWarning, perm: 'complaints.manage', badge: c.openComplaints },
    { to: `${base}/announcements`, label: 'Announcements', icon: Megaphone, perm: 'view' },
    { to: `${base}/statements`, label: 'Revenue statements', icon: FileText, perm: 'statements.view' },
    { to: `${base}/audit`, label: 'Decision history', icon: ShieldCheck, perm: 'audit.view' },
    { to: `${base}/settings`, label: 'Settings', icon: Settings, perm: 'view' },
  ];
  return (
    <CommunityContext.Provider value={q.data}>
      <ConsoleLayout
        title={q.data.community.name}
        notificationsTo={`${base}/notifications`}
        header={<CommunitySwitcher />}
        nav={nav.filter((n) => !n.perm || can(n.perm))}
      />
    </CommunityContext.Provider>
  );
}
