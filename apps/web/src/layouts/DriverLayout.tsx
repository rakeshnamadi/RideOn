import { Bus, Gauge, HelpCircle, History, IndianRupee, UserCircle } from 'lucide-react';
import { ConsoleLayout } from './ConsoleLayout';

export function DriverLayout() {
  return (
    <ConsoleLayout
      title="Driver"
      notificationsTo="/driver/notifications"
      nav={[
        { to: '/driver', label: 'Today', icon: Gauge, end: true },
        { to: '/driver/shared', label: 'Shared departures', icon: Bus },
        { to: '/driver/earnings', label: 'Earnings', icon: IndianRupee },
        { to: '/driver/history', label: 'Trip history', icon: History },
        { to: '/driver/profile', label: 'Profile & documents', icon: UserCircle },
        { to: '/driver/support', label: 'Help & complaints', icon: HelpCircle },
      ]}
    />
  );
}
