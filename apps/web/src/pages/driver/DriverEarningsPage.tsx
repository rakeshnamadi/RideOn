import { useState } from 'react';
import { Alert, Card, DataTable, Input, PageHeader, QueryState, Stat } from '@/components/ui';
import { useApi } from '@/hooks/api';
import { inr } from '@/utils/format';
import { useT } from '@/i18n';

interface Earnings {
  month: string;
  totals: { trips: number; farePaise: number; platformFeePaise: number; communityFeePaise: number; processingFeePaise: number; driverNetPaise: number; cashCollectedPaise: number };
  feesOwedOnCashPaise: number;
  days: { date: string; trips: number; farePaise: number; platformFeePaise: number; communityFeePaise: number; driverNetPaise: number }[];
}

/** Transparent earnings: gross fares, every deduction, and net. */
export default function DriverEarningsPage() {
  const { t } = useT();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const q = useApi<Earnings>(['driver', 'earnings', month], '/drivers/me/earnings', { month });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  return (
    <div className="space-y-5">
      <PageHeader title={t('driver.navEarnings')} subtitle={t('driver.earningsSubtitle')} actions={<Input label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />} />
      <QueryState query={q}>
        {(e) => {
          const todayRow = e.days.find((d) => d.date === today);
          return (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Today (net)" value={inr(todayRow?.driverNetPaise ?? 0)} hint={`${todayRow?.trips ?? 0} trips`} tone="good" />
                <Stat label="Month fares" value={inr(e.totals.farePaise)} hint={`${e.totals.trips} trips`} />
                <Stat label="Platform + community fees" value={inr(e.totals.platformFeePaise + e.totals.communityFeePaise)} hint={`Platform ${inr(e.totals.platformFeePaise)} · community ${inr(e.totals.communityFeePaise)}`} />
                <Stat label="Month net earnings" value={inr(e.totals.driverNetPaise)} tone="good" />
              </div>
              {e.feesOwedOnCashPaise > 0 && (
                <Alert tone="info">
                  You collected {inr(e.totals.cashCollectedPaise)} in cash this month. Fees on cash trips ({inr(e.feesOwedOnCashPaise)}) are settled through your community statement.
                </Alert>
              )}
              <Card title="By day">
                <DataTable
                  rows={e.days}
                  rowKey={(d) => d.date}
                  empty="No completed trips this month"
                  columns={[
                    { header: 'Date', cell: (d) => d.date },
                    { header: 'Trips', cell: (d) => d.trips, className: 'text-right' },
                    { header: 'Fares', cell: (d) => inr(d.farePaise), className: 'text-right tabular-nums' },
                    { header: 'Platform fee', cell: (d) => inr(d.platformFeePaise), className: 'text-right tabular-nums' },
                    { header: 'Community fee', cell: (d) => inr(d.communityFeePaise), className: 'text-right tabular-nums' },
                    { header: 'Net', cell: (d) => <strong>{inr(d.driverNetPaise)}</strong>, className: 'text-right tabular-nums' },
                  ]}
                />
              </Card>
              <p className="text-xs text-stone-500">Figures are estimates until your community statement is issued. Fees follow the platform fee schedule and your community’s published policy.</p>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
