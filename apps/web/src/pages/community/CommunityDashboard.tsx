import { Link } from 'react-router-dom';
import { Card, PageHeader, QueryState, Stat, StatusBadge, Alert } from '@/components/ui';
import { useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { humanize, inr } from '@/utils/format';

interface Stats {
  periodDays: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  completedTrips: number;
  revenue: { farePaise: number | null; platformFeePaise: number | null; communityFeePaise: number | null; driverNetPaise: number | null };
  topCancellationReasons: { reason: string; count: number }[];
}

export default function CommunityDashboard() {
  const { community, counts, id, can } = useCommunity();
  const stats = useApi<Stats>(['community', id, 'stats'], can('bookings.view') ? `/communities/${id}/stats` : null);
  const base = `/community/${id}`;
  return (
    <div className="space-y-5">
      <PageHeader title={community.name} subtitle={<span className="flex items-center gap-2">{community.city.name} <StatusBadge status={community.status} /></span>} />
      {community.status !== 'ACTIVE' && <Alert tone="warn">This community is {community.status.toLowerCase()} on the platform. Passengers cannot book it until it is active.</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Drivers online" value={counts.onlineDrivers} />
        <Link to={`${base}/members`}><Stat label="Pending applications" value={counts.pendingMembers} tone={counts.pendingMembers ? 'warn' : 'default'} /></Link>
        <Link to={`${base}/vehicles`}><Stat label="Vehicles to review" value={counts.pendingVehicles} tone={counts.pendingVehicles ? 'warn' : 'default'} /></Link>
        <Link to={`${base}/fares`}><Stat label="Open fare proposals" value={counts.pendingProposals} tone={counts.pendingProposals ? 'warn' : 'default'} /></Link>
        <Link to={`${base}/complaints`}><Stat label="Open complaints" value={counts.openComplaints} tone={counts.openComplaints ? 'warn' : 'default'} /></Link>
      </div>
      {stats.data !== undefined || stats.isLoading ? (
        <QueryState query={stats}>
          {(s) => {
            const total = Object.values(s.byStatus).reduce((a, b) => a + b, 0);
            return (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card title={`Last ${s.periodDays} days`}>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Bookings" value={total} hint={`${s.byType.REGULAR ?? 0} regular · ${s.byType.SHARED ?? 0} shared`} />
                    <Stat label="Completed" value={s.completedTrips} />
                    <Stat label="Fares" value={inr(s.revenue.farePaise ?? 0)} />
                    <Stat label="Community fees" value={inr(s.revenue.communityFeePaise ?? 0)} hint={`Drivers earned ${inr(s.revenue.driverNetPaise ?? 0)}`} />
                  </div>
                </Card>
                <Card title="Booking outcomes">
                  <ul className="space-y-1.5 text-sm">
                    {Object.entries(s.byStatus).map(([k, v]) => (
                      <li key={k} className="flex items-center gap-2">
                        <StatusBadge status={k} />
                        <div className="h-2 flex-1 rounded bg-stone-100"><div className="h-2 rounded bg-brand-600" style={{ width: `${total ? (v / total) * 100 : 0}%` }} /></div>
                        <span className="w-10 text-right tabular-nums">{v}</span>
                      </li>
                    ))}
                    {total === 0 && <li className="text-stone-500">No bookings yet.</li>}
                  </ul>
                  {s.topCancellationReasons.length > 0 && (
                    <>
                      <h3 className="mt-4 text-sm font-semibold">Top cancellation reasons</h3>
                      <ul className="mt-1 text-sm text-stone-600">{s.topCancellationReasons.map((r) => <li key={r.reason}>{humanize(r.reason)} — {r.count}</li>)}</ul>
                    </>
                  )}
                </Card>
              </div>
            );
          }}
        </QueryState>
      ) : null}
    </div>
  );
}
