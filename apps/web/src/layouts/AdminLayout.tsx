import { Building2, Car, ClipboardList, FileBarChart, Gauge, IdCard, LifeBuoy, MapPinned, MessageSquareWarning, Scale, Settings, ShieldCheck, Users } from 'lucide-react';
import { useApi } from '@/hooks/api';
import { ConsoleLayout } from './ConsoleLayout';

export function AdminLayout() {
  const dash = useApi<{ issues: { pendingVerifications: number; pendingReviews: number; openTickets: number; openComplaints: number } }>(['admin', 'dashboard'], '/admin/dashboard', undefined, { refetchInterval: 60_000 });
  const issues = dash.data?.issues;
  return (
    <ConsoleLayout
      title="Platform admin"
      notificationsTo="/admin/notifications"
      nav={[
        { to: '/admin', label: 'Overview', icon: Gauge, end: true },
        { to: '/admin/communities', label: 'Communities', icon: Building2 },
        { to: '/admin/drivers', label: 'Driver verification', icon: IdCard, badge: issues?.pendingVerifications },
        { to: '/admin/fare-reviews', label: 'Fare reviews', icon: Scale, badge: issues?.pendingReviews },
        { to: '/admin/bookings', label: 'Bookings', icon: Car },
        { to: '/admin/complaints', label: 'Complaints', icon: MessageSquareWarning, badge: issues?.openComplaints },
        { to: '/admin/support', label: 'Support & incidents', icon: LifeBuoy, badge: issues?.openTickets },
        { to: '/admin/users', label: 'Users', icon: Users },
        { to: '/admin/cities', label: 'Cities', icon: MapPinned },
        { to: '/admin/settings', label: 'Fees & settings', icon: Settings },
        { to: '/admin/reports', label: 'Reports', icon: FileBarChart },
        { to: '/admin/audit', label: 'Audit log', icon: ShieldCheck },
        { to: '/app', label: 'Passenger view', icon: ClipboardList },
      ]}
    />
  );
}
