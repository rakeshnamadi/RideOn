import { useState } from 'react';
import { Badge, Button, Card, DataTable, ErrorState, Modal, PageHeader, Pagination, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';
import { useAction, useApiPage } from '@/hooks/api';
import { api } from '@/services/api';
import { dateTime, humanize } from '@/utils/format';

interface Ticket {
  id: string;
  reference: string;
  kind: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  bookingId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  user: { name: string };
}

export default function AdminSupportPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('OPEN');
  const q = useApiPage<Ticket>(['admin', 'tickets'], '/support-tickets', { page, status });
  const [open, setOpen] = useState<Ticket | null>(null);
  const [next, setNext] = useState('IN_PROGRESS');
  const [note, setNote] = useState('');
  const update = useAction(() => api.patch(`/support-tickets/${open!.id}`, { status: next, resolutionNote: note || undefined }), { invalidate: [['admin']], success: 'Ticket updated', onSuccess: () => setOpen(null) });
  return (
    <div>
      <PageHeader title="Support & incidents" subtitle="Safety tickets (including SOS alerts) are marked urgent." />
      <Card>
        <Select className="mb-4 max-w-xs" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={['', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => ({ value: s, label: s ? humanize(s) : 'All' }))} />
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : (
          <>
            <DataTable
              rows={q.data?.data ?? []}
              rowKey={(r) => r.id}
              empty="No tickets"
              columns={[
                { header: 'Ref', cell: (r) => r.reference },
                { header: 'Type', cell: (r) => <Badge tone={r.kind === 'SAFETY' ? 'red' : r.kind === 'INCIDENT' ? 'amber' : 'gray'}>{humanize(r.kind)}</Badge> },
                { header: 'Priority', cell: (r) => <StatusBadge status={r.priority} /> },
                { header: 'Subject', cell: (r) => r.subject },
                { header: 'From', cell: (r) => r.user.name },
                { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                { header: 'Created', cell: (r) => dateTime(r.createdAt) },
                { header: '', cell: (r) => <Button size="sm" variant="secondary" onClick={() => { setOpen(r); setNote(r.resolutionNote ?? ''); setNext(r.status === 'OPEN' ? 'IN_PROGRESS' : 'RESOLVED'); }}>Handle</Button> },
              ]}
            />
            <Pagination page={page} totalPages={Number(q.data?.meta?.totalPages ?? 1)} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.reference}: ${open.subject}` : ''} footer={<Button loading={update.isPending} onClick={() => update.mutate()}>Save</Button>}>
        {open && (
          <div className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap rounded bg-stone-50 p-3">{open.description}</p>
            {open.bookingId && <p>Booking ID: <code>{open.bookingId}</code></p>}
            <Select label="Status" value={next} onChange={(e) => setNext(e.target.value)} options={['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => ({ value: s, label: humanize(s) }))} />
            <Textarea label="Note to the user" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
      </Modal>
    </div>
  );
}
