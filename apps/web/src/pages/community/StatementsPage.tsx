import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, DataTable, Input, PageHeader, QueryState, Stat, StatusBadge } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { downloadFile } from '@/services/api';
import { date, inr } from '@/utils/format';

interface Statements {
  statements: { id: string; periodStart: string; periodEnd: string; tripCount: number; totalFarePaise: number; platformFeePaise: number; communityFeePaise: number; driverNetPaise: number; status: string }[];
  unsettled: { trips: number; farePaise: number | null; platformFeePaise: number | null; communityFeePaise: number | null; driverNetPaise: number | null };
}

export default function StatementsPage() {
  const { id } = useCommunity();
  const toast = useToast();
  const q = useApi<Statements>(['community', id, 'statements'], `/reports/communities/${id}/statements`);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const exportCsv = async () => {
    setBusy(true);
    try {
      const end = new Date(new Date(to).getTime() + 86_400_000).toISOString().slice(0, 10);
      await downloadFile('/reports/bookings.csv', { communityId: id, from, to: end }, `bookings-${from}-to-${to}.csv`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Revenue statements" subtitle="Platform and community fees on completed trips. Statements are issued by the platform." />
      <QueryState query={q}>
        {(s) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Not yet statemented" value={s.unsettled.trips} hint="completed trips" />
              <Stat label="Fares" value={inr(s.unsettled.farePaise ?? 0)} />
              <Stat label="Platform fees" value={inr(s.unsettled.platformFeePaise ?? 0)} />
              <Stat label="Community fees" value={inr(s.unsettled.communityFeePaise ?? 0)} tone="good" />
            </div>
            <Card title="Statements">
              <DataTable
                rows={s.statements}
                rowKey={(r) => r.id}
                empty="No statements issued yet"
                columns={[
                  { header: 'Period', cell: (r) => `${date(r.periodStart)} – ${date(r.periodEnd)}` },
                  { header: 'Trips', cell: (r) => r.tripCount },
                  { header: 'Fares', cell: (r) => inr(r.totalFarePaise), className: 'text-right tabular-nums' },
                  { header: 'Platform fees', cell: (r) => inr(r.platformFeePaise), className: 'text-right tabular-nums' },
                  { header: 'Community fees', cell: (r) => inr(r.communityFeePaise), className: 'text-right tabular-nums' },
                  { header: 'Drivers', cell: (r) => inr(r.driverNetPaise), className: 'text-right tabular-nums' },
                  { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                ]}
              />
            </Card>
          </>
        )}
      </QueryState>
      <Card title="Export bookings (CSV)">
        <div className="flex flex-wrap items-end gap-3">
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          <Button icon={<Download className="size-4" />} loading={busy} onClick={exportCsv}>Download CSV</Button>
        </div>
        <p className="mt-2 text-xs text-stone-500">Exports contain no passenger contact details. Each export is recorded in the audit log.</p>
      </Card>
    </div>
  );
}
