import { Link } from 'react-router-dom';
import { Alert, Card, PageHeader, QueryState, Stat, StatusBadge } from '@/components/ui';
import { useApi } from '@/hooks/api';
import { dateTime, inr } from '@/utils/format';

interface Dashboard {
  communities: Record<string, number>;
  activeDrivers: number;
  onlineDrivers: number;
  passengers: number;
  bookings: { last30Days: number; byStatus: Record<string, number>; cancellationRate: number };
  revenue: { completedTrips: number; farePaise: number | null; platformFeePaise: number | null; communityFeePaise: number | null; driverNetPaise: number | null };
  issues: { openTickets: number; openComplaints: number; pendingVerifications: number; pendingReviews: number };
  recentSos: { id: string; createdAt: string; note: string | null; booking: { reference: string } | null }[];
}

export default function AdminDashboard() {
  const q = useApi<Dashboard>(['admin', 'dashboard'], '/admin/dashboard', undefined, { refetchInterval: 30_000 });
  return (
    <div className="space-y-5">
      <PageHeader title="Platform overview" subtitle="Last 30 days across all communities" />
      <QueryState query={q}>
        {(d) => (
          <>
            {d.recentSos.length > 0 && (
              <Alert tone="error">
                <strong>Recent SOS alerts:</strong> {d.recentSos.map((s) => `${s.booking?.reference ?? 'trip'} at ${dateTime(s.createdAt)}`).join(' · ')}. <Link to="/admin/support" className="underline">Open incidents</Link>
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Active communities" value={d.communities.ACTIVE ?? 0} hint={`${d.communities.PENDING ?? 0} pending · ${d.communities.SUSPENDED ?? 0} suspended`} />
              <Stat label="Verified drivers" value={d.activeDrivers} hint={`${d.onlineDrivers} online now`} />
              <Stat label="Passengers" value={d.passengers} />
              <Stat label="Bookings" value={d.bookings.last30Days} hint={`${d.bookings.cancellationRate}% cancelled`} />
              <Stat label="Completed trips" value={d.revenue.completedTrips} />
              <Stat label="Gross fares" value={inr(d.revenue.farePaise ?? 0)} />
              <Stat label="Platform revenue" value={inr(d.revenue.platformFeePaise ?? 0)} tone="good" />
              <Stat label="Paid to communities" value={inr(d.revenue.communityFeePaise ?? 0)} hint={`Drivers: ${inr(d.revenue.driverNetPaise ?? 0)}`} />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Needs attention">
                <ul className="space-y-2 text-sm">
                  <li className="flex justify-between"><Link className="text-brand-700 hover:underline" to="/admin/drivers">Driver verifications pending</Link><strong>{d.issues.pendingVerifications}</strong></li>
                  <li className="flex justify-between"><Link className="text-brand-700 hover:underline" to="/admin/fare-reviews">Fare proposals awaiting platform review</Link><strong>{d.issues.pendingReviews}</strong></li>
                  <li className="flex justify-between"><Link className="text-brand-700 hover:underline" to="/admin/complaints">Open complaints</Link><strong>{d.issues.openComplaints}</strong></li>
                  <li className="flex justify-between"><Link className="text-brand-700 hover:underline" to="/admin/support">Open support tickets</Link><strong>{d.issues.openTickets}</strong></li>
                </ul>
              </Card>
              <Card title="Booking outcomes">
                <ul className="space-y-1 text-sm">
                  {Object.entries(d.bookings.byStatus).map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between"><StatusBadge status={k} /><span className="tabular-nums">{v}</span></li>
                  ))}
                </ul>
              </Card>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
