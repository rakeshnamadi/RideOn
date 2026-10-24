import { useState } from 'react';
import { Button, Card, ConfirmDialog, DataTable, ErrorState, Input, Modal, PageHeader, Pagination, Spinner, StatusBadge, Tabs, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useAction, useApi, useApiPage } from '@/hooks/api';
import { api, openPrivateFile } from '@/services/api';
import { date, humanize } from '@/utils/format';

interface Row {
  id: string;
  licenseNumber: string;
  licenseExpiry: string;
  verificationStatus: string;
  status: string;
  user: { name: string; phone: string; status: string };
  documents: { id: string; type: string; status: string }[];
  memberships: { status: string; community: { name: string } }[];
}
interface Detail {
  documents: { id: string; type: string; status: string; originalName: string; reviewNote: string | null; createdAt: string }[];
}

function Review({ driver, onDone }: { driver: Row; onDone: () => void }) {
  const toast = useToast();
  const q = useApi<Detail>(['driver-detail', driver.id], `/drivers/${driver.id}`);
  const reviewDoc = useAction(({ docId, status }: { docId: string; status: string }) => api.post(`/admin/documents/${docId}/review`, { status }), { invalidate: [['driver-detail', driver.id], ['admin', 'drivers']], success: 'Document reviewed' });
  const [note, setNote] = useState('');
  const verify = useAction((status: string) => api.post(`/admin/drivers/${driver.id}/verification`, { status, note: note || undefined }), { invalidate: [['admin']], success: 'Verification updated', onSuccess: onDone });
  if (q.isLoading || !q.data) return <Spinner />;
  return (
    <div className="space-y-4">
      <p className="text-sm">Licence {driver.licenseNumber}, valid until {date(driver.licenseExpiry)}. Verify identity against the licence and ID proof.</p>
      <DataTable
        rows={q.data.documents}
        rowKey={(d) => d.id}
        empty="No documents"
        columns={[
          { header: 'Type', cell: (d) => humanize(d.type) },
          { header: 'File', cell: (d) => <button className="text-brand-700 hover:underline" onClick={() => openPrivateFile(`/drivers/documents/${d.id}/file`).catch((e) => toast.error(e))}>View</button> },
          { header: 'Status', cell: (d) => <StatusBadge status={d.status} /> },
          { header: '', cell: (d) => <div className="flex gap-1"><Button size="sm" onClick={() => reviewDoc.mutate({ docId: d.id, status: 'APPROVED' })}>Approve</Button><Button size="sm" variant="secondary" onClick={() => reviewDoc.mutate({ docId: d.id, status: 'REJECTED' })}>Reject</Button></div> },
        ]}
      />
      <Textarea label="Note to driver (required when rejecting)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <Button loading={verify.isPending} onClick={() => verify.mutate('VERIFIED')}>Mark verified</Button>
        <Button variant="danger" loading={verify.isPending} onClick={() => verify.mutate('REJECTED')}>Reject</Button>
      </div>
    </div>
  );
}

export default function AdminDriversPage() {
  const [tab, setTab] = useState<'UNDER_REVIEW' | 'PENDING' | 'VERIFIED' | 'REJECTED'>('UNDER_REVIEW');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useApiPage<Row>(['admin', 'drivers', tab, search], '/admin/drivers', { verificationStatus: tab, search, page });
  const [open, setOpen] = useState<Row | null>(null);
  const [suspend, setSuspend] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const setStatus = useAction(() => api.post(`/admin/drivers/${suspend!.id}/status`, { status: suspend!.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED', reason }), { invalidate: [['admin', 'drivers']], success: 'Driver status updated', onSuccess: () => { setSuspend(null); setReason(''); } });
  return (
    <div>
      <PageHeader title="Driver verification" subtitle="Platform-level identity and licence checks. Communities separately approve membership and vehicles." />
      <Tabs value={tab} onChange={(t) => { setTab(t); setPage(1); }} options={[{ value: 'UNDER_REVIEW', label: 'Under review' }, { value: 'PENDING', label: 'Awaiting documents' }, { value: 'VERIFIED', label: 'Verified' }, { value: 'REJECTED', label: 'Rejected' }]} />
      <Card>
        <Input label="Search name or licence" className="mb-4 max-w-sm" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : (
          <>
            <DataTable
              rows={q.data?.data ?? []}
              rowKey={(r) => r.id}
              empty="No drivers"
              columns={[
                { header: 'Driver', cell: (r) => <><p className="font-medium">{r.user.name}</p><p className="text-xs text-stone-500">{r.user.phone}</p></> },
                { header: 'Licence', cell: (r) => r.licenseNumber },
                { header: 'Documents', cell: (r) => <span className="text-xs">{r.documents.map((d) => `${humanize(d.type)}: ${d.status.toLowerCase()}`).join(' · ') || 'None'}</span> },
                { header: 'Communities', cell: (r) => <span className="text-xs">{r.memberships.map((m) => `${m.community.name} (${m.status.toLowerCase()})`).join(', ') || '—'}</span> },
                { header: 'Status', cell: (r) => <><StatusBadge status={r.verificationStatus} /> {r.status === 'SUSPENDED' && <StatusBadge status="SUSPENDED" />}</> },
                { header: '', cell: (r) => <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => setOpen(r)}>Review</Button><Button size="sm" variant="ghost" onClick={() => setSuspend(r)}>{r.status === 'SUSPENDED' ? 'Reinstate' : 'Suspend'}</Button></div> },
              ]}
            />
            <Pagination page={page} totalPages={Number(q.data?.meta?.totalPages ?? 1)} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={`Review ${open?.user.name ?? ''}`}>{open && <Review driver={open} onDone={() => setOpen(null)} />}</Modal>
      <ConfirmDialog open={!!suspend} title={`${suspend?.status === 'SUSPENDED' ? 'Reinstate' : 'Suspend'} ${suspend?.user.name}?`} message="This applies platform-wide, across every community." confirmLabel="Confirm" loading={setStatus.isPending} onClose={() => setSuspend(null)} onConfirm={() => setStatus.mutate()}>
        <Textarea label="Reason (recorded and sent to the driver)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
