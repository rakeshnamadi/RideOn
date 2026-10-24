import { useState } from 'react';
import { Badge, Button, Card, DataTable, ErrorState, Modal, Pagination, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';
import { useAction, useApiPage } from '@/hooks/api';
import { api } from '@/services/api';
import { dateTime, humanize } from '@/utils/format';

interface Complaint {
  id: string;
  reference: string;
  kind: string;
  category: string;
  description: string;
  status: string;
  resolution: string | null;
  createdAt: string;
  raisedBy: { name: string };
  booking: { reference: string } | null;
  community: { name: string };
  againstDriver: { id: string; user: { name: string } } | null;
}

/** Shared complaint/dispute/appeal handling for community staff and the platform. */
export function ComplaintsBoard({ communityId, platform }: { communityId?: string; platform?: boolean }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const q = useApiPage<Complaint>(['complaints', communityId ?? 'all'], '/complaints', { page, status, communityId });
  const [open, setOpen] = useState<Complaint | null>(null);
  const [next, setNext] = useState('IN_REVIEW');
  const [resolution, setResolution] = useState('');
  const update = useAction(() => api.patch(`/complaints/${open!.id}`, { status: next, resolution: resolution || undefined }), {
    invalidate: [['complaints']],
    success: 'Complaint updated',
    onSuccess: () => setOpen(null),
  });
  return (
    <Card>
      <Select className="mb-4 max-w-xs" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={['', 'OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED', 'REJECTED'].map((s) => ({ value: s, label: s ? humanize(s) : 'All' }))} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <DataTable
            rows={q.data?.data ?? []}
            rowKey={(r) => r.id}
            empty="No complaints"
            columns={[
              { header: 'Ref', cell: (r) => r.reference },
              { header: 'Kind', cell: (r) => <><Badge tone={r.kind === 'APPEAL' ? 'blue' : r.category === 'SAFETY' ? 'red' : 'gray'}>{humanize(r.kind)}</Badge> <span className="text-sm">{humanize(r.category)}</span></> },
              ...(platform ? [{ header: 'Community', cell: (r: Complaint) => r.community.name }] : []),
              { header: 'Raised by', cell: (r) => r.raisedBy.name },
              { header: 'About', cell: (r) => (r.againstDriver ? `Driver ${r.againstDriver.user.name}` : r.booking ? `Booking ${r.booking.reference}` : '—') },
              { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              { header: 'Raised', cell: (r) => dateTime(r.createdAt) },
              { header: '', cell: (r) => <Button size="sm" variant="secondary" onClick={() => { setOpen(r); setNext(r.status === 'OPEN' ? 'IN_REVIEW' : 'RESOLVED'); setResolution(r.resolution ?? ''); }}>Handle</Button> },
            ]}
          />
          <Pagination page={page} totalPages={Number(q.data?.meta?.totalPages ?? 1)} onPage={setPage} />
        </>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.reference} · ${humanize(open.kind)}` : ''} footer={<Button loading={update.isPending} onClick={() => update.mutate()}>Save</Button>}>
        {open && (
          <div className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap rounded bg-stone-50 p-3">{open.description}</p>
            <Select label="New status" value={next} onChange={(e) => setNext(e.target.value)} options={['IN_REVIEW', 'RESOLVED', 'REJECTED', 'ESCALATED'].map((s) => ({ value: s, label: humanize(s) }))} hint={!platform ? 'Escalate to send it to the platform team (e.g. appeals against this community’s own decisions).' : undefined} />
            <Textarea label="Resolution / note to the person who raised it" value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </div>
        )}
      </Modal>
    </Card>
  );
}
