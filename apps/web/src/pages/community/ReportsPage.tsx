import { Download, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, ConfirmDialog, DataTable, EmptyState, Input, Modal, PageHeader, QueryState, Stat, StatusBadge, Textarea } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api, downloadFile } from '@/services/api';
import { date, dateTime, humanize, inr } from '@/utils/format';

interface Metrics {
  bookings: { total: number; regular: number; shared: number };
  completedTrips: number;
  farePaise: number;
  communityFeePaise: number;
  driverNetPaise: number;
  cancellations: { total: number; topReasons: { reason: string; count: number }[] };
  drivers: { approved: number; applications: number; activeMembers: number };
  complaints: { opened: number; resolved: number };
  fareFeedback: Record<string, number>;
  busiestPickupPoints: { name: string; trips: number }[];
  generatedAt: string;
}
interface ReportSummary {
  id: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED';
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  publishedAt: string | null;
}
interface Report extends ReportSummary {
  notes: string | null;
  metrics: Metrics;
}

const isoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const startOf = (day: string) => new Date(`${day}T00:00:00+05:30`).toISOString();
const endOf = (day: string) => new Date(new Date(`${day}T00:00:00+05:30`).getTime() + 86_400_000).toISOString();
/** Periods end at midnight after their last day; show that last day. */
const lastDay = (periodEnd: string) => date(new Date(new Date(periodEnd).getTime() - 1));

function PrepareReport({ onDone }: { onDone: (r: Report) => void }) {
  const { id } = useCommunity();
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(isoDay(new Date()));
  const create = useAction(() => api.post<Report>(`/communities/${id}/reports`, { title, from: startOf(from), to: endOf(to) }), { invalidate: [['community', id, 'reports']], success: 'Report prepared', onSuccess: onDone });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. October members’ meeting" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <Button type="submit" disabled={title.trim().length < 3 || !from || !to || to < from} loading={create.isPending}>Prepare report</Button>
    </form>
  );
}

function ReportDetail({ report, onDeleted }: { report: Report; onDeleted: () => void }) {
  const { id } = useCommunity();
  const inv = [['community', id, 'reports']];
  const path = `/communities/${id}/reports/${report.id}`;
  const [notes, setNotes] = useState(report.notes ?? '');
  useEffect(() => setNotes(report.notes ?? ''), [report.id, report.notes]);
  const saveNotes = useAction(() => api.patch(path, { notes: notes || null }), { invalidate: inv, success: 'Notes saved' });
  const refresh = useAction(() => api.post(`${path}/refresh`), { invalidate: inv, success: 'Figures updated from current data' });
  const [confirm, setConfirm] = useState<'publish' | 'delete' | null>(null);
  const publish = useAction(() => api.patch(path, { status: 'PUBLISHED', notes: notes || null }), { invalidate: inv, success: 'Report published', onSuccess: () => setConfirm(null) });
  const remove = useAction(() => api.del(path), { invalidate: inv, success: 'Draft deleted', onSuccess: () => { setConfirm(null); onDeleted(); } });
  const m = report.metrics;
  const draft = report.status === 'DRAFT';
  return (
    <Card
      title={<span className="flex items-center gap-2">{report.title} <StatusBadge status={report.status} /></span>}
      actions={
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => void downloadFile(`${path}/export.csv`, {}, `report-${report.periodStart.slice(0, 10)}.csv`)}>CSV</Button>
          {draft && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={refresh.isPending} onClick={() => refresh.mutate()}>Refresh figures</Button>}
          {draft && <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirm('delete')}>Delete</Button>}
          {draft && <Button size="sm" onClick={() => setConfirm('publish')}>Publish</Button>}
        </div>
      }
    >
      <p className="mb-4 text-sm text-muted">{date(report.periodStart)} to {lastDay(report.periodEnd)} · figures as of {dateTime(m.generatedAt)}{report.publishedAt ? ` · published ${dateTime(report.publishedAt)}` : ''}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Completed trips" value={m.completedTrips} hint={`${m.bookings.total} bookings: ${m.bookings.regular} regular, ${m.bookings.shared} shared`} />
        <Stat label="Fares collected" value={inr(m.farePaise)} hint={`Drivers kept ${inr(m.driverNetPaise)}`} tone="good" />
        <Stat label="Union fund" value={inr(m.communityFeePaise)} />
        <Stat label="Active drivers" value={m.drivers.activeMembers} hint={`${m.drivers.approved} approved of ${m.drivers.applications} applications`} />
        <Stat label="Cancellations" value={m.cancellations.total} hint={m.cancellations.topReasons[0]?.reason} />
        <Stat label="Complaints" value={m.complaints.opened} hint={`${m.complaints.resolved} resolved`} />
        <Stat label="Fare feedback" value={Object.values(m.fareFeedback).reduce((a, b) => a + b, 0)} hint={Object.entries(m.fareFeedback).map(([k, v]) => `${humanize(k)}: ${v}`).join(' · ') || undefined} />
        <Stat label="Busiest pickup" value={m.busiestPickupPoints[0]?.name ?? '—'} hint={m.busiestPickupPoints[0] ? `${m.busiestPickupPoints[0].trips} trips` : undefined} />
      </div>
      <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); saveNotes.mutate(); }}>
        <Textarea label="Notes" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What members should know about this period" />
        <Button type="submit" variant="secondary" size="sm" loading={saveNotes.isPending}>Save notes</Button>
      </form>
      <ConfirmDialog open={confirm === 'publish'} title="Publish this report?" message="Its title and figures are frozen once published. You can still edit the notes." confirmLabel="Publish" loading={publish.isPending} onClose={() => setConfirm(null)} onConfirm={() => publish.mutate()} />
      <ConfirmDialog open={confirm === 'delete'} title="Delete this draft?" message="The draft and its notes are removed." confirmLabel="Delete" tone="danger" loading={remove.isPending} onClose={() => setConfirm(null)} onConfirm={() => remove.mutate()} />
    </Card>
  );
}

export default function ReportsPage() {
  const { id } = useCommunity();
  const q = useApi<ReportSummary[]>(['community', id, 'reports'], `/communities/${id}/reports`);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useApi<Report>(['community', id, 'reports', selected], selected ? `/communities/${id}/reports/${selected}` : null);
  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle="Prepare a report for any period, add your notes, and publish it for the record." actions={<Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New report</Button>} />
      <QueryState query={q} empty={(d) => d.length === 0 && <EmptyState title="No reports yet">Prepare your first report to see trips, fares, drivers and complaints for a period.</EmptyState>}>
        {(rows) => (
          <Card>
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              columns={[
                { header: 'Report', cell: (r) => <button className="font-medium text-brand-700 hover:underline" onClick={() => setSelected(r.id)}>{r.title}</button> },
                { header: 'Period', cell: (r) => `${date(r.periodStart)} to ${lastDay(r.periodEnd)}` },
                { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                { header: 'Prepared', cell: (r) => dateTime(r.createdAt) },
              ]}
            />
          </Card>
        )}
      </QueryState>
      {selected && <QueryState query={detail}>{(r) => <ReportDetail report={r} onDeleted={() => setSelected(null)} />}</QueryState>}
      <Modal open={creating} onClose={() => setCreating(false)} title="New report">
        {creating && <PrepareReport onDone={(r) => { setCreating(false); setSelected(r.id); }} />}
      </Modal>
    </div>
  );
}
