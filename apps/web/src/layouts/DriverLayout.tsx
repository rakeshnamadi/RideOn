import { Bus, Gauge, HelpCircle, History, IndianRupee, MessageSquarePlus, UserCircle } from 'lucide-react';
import { useT } from '@/i18n';
import { ConsoleLayout } from './ConsoleLayout';

export function DriverLayout() {
  const { t } = useT();
  return (
    <ConsoleLayout
      title={t('driver.console')}
      notificationsTo="/driver/notifications"
      nav={[
        { to: '/driver', label: t('driver.navToday'), icon: Gauge, end: true },
        { to: '/driver/shared', label: t('driver.navShared'), icon: Bus },
        { to: '/driver/fares', label: t('driver.navFares'), icon: MessageSquarePlus },
        { to: '/driver/earnings', label: t('driver.navEarnings'), icon: IndianRupee },
        { to: '/driver/history', label: t('driver.navHistory'), icon: History },
        { to: '/driver/profile', label: t('driver.navProfile'), icon: UserCircle },
        { to: '/driver/support', label: t('driver.navSupport'), icon: HelpCircle },
      ]}
    />
  );
}
