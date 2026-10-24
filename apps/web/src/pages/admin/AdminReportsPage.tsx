import { Download, FileText } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Input, PageHeader, Select } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useAction, useApi } from '@/hooks/api';
import { api, downloadFile } from '@/services/api';
import { inr } from '@/utils/format';

export default function AdminReportsPage() {
  const toast = useToast();
  const communities = useApi<{ id: string; name: string }[]>(['admin', 'communities', ''], '/admin/communities');
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [communityId, setCommunityId] = useState('');
  const [busy, setBusy] = useState(false);
  const end = () => new Date(new Date(to).getTime() + 86_400_000).toISOString().slice(0, 10);
  const exportCsv = async () => {
    setBusy(true);
    try {
      await downloadFile('/reports/bookings.csv', { communityId: communityId || undefined, from, to: end() }, `rideon-bookings-${from}-to-${to}.csv`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const statement = useAction(() => api.post<{ tripCount: number; totalFarePaise: number; communityFeePaise: number }>(`/reports/communities/${communityId}/statements`, { from, to: end() }), {
    success: (s) => `Statement issued: ${s.tripCount} trips, fares ${inr(s.totalFarePaise)}, community fees ${inr(s.communityFeePaise)}`,
  });
  return (
    <div className="space-y-5">
      <PageHeader title="Reports" />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          <Select label="Community" value={communityId} onChange={(e) => setCommunityId(e.target.value)} options={[{ value: '', label: 'All communities' }, ...(communities.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button icon={<Download className="size-4" />} loading={busy} onClick={exportCsv}>Export bookings CSV</Button>
          <Button variant="secondary" icon={<FileText className="size-4" />} disabled={!communityId} loading={statement.isPending} onClick={() => statement.mutate()}>Issue community statement</Button>
        </div>
        <p className="mt-3 text-xs text-stone-500">A statement covers every completed trip in the period not already on a statement, so trips are never counted twice. Exports and statements are recorded in the audit log.</p>
      </Card>
    </div>
  );
}
