import { useState } from 'react';
import { Button, Card, DataTable, Modal, PageHeader, QueryState, StatusBadge, Spinner, Input } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api, openPrivateFile } from '@/services/api';
import { date, humanize } from '@/utils/format';

interface DriverRow {
  id: string;
  membershipStatus: string;
  licenseNumber: string;
  licenseExpiry: string;
  verificationStatus: string;
  status: string;
  ratingSum: number;
  ratingCount: number;
  user: { name: string; phone: string };
  availability: { status: string; communityId: string | null } | null;
  vehicleAssignments: { vehicle: { id: string; registrationNumber: string; status: string; seatCapacity: number } }[];
}
interface DriverDetail {
  id: string;
  user: { name: string };
  documents: { id: string; type: string; status: string; originalName: string; reviewNote: string | null; createdAt: string }[];
}

function DocumentsReview({ driverId, communityId }: { driverId: string; communityId: string }) {
  const toast = useToast();
  const q = useApi<DriverDetail>(['driver-detail', driverId], `/drivers/${driverId}`);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const review = useAction(({ docId, status }: { docId: string; status: string }) => api.post(`/communities/${communityId}/documents/${docId}/review`, { status, note: notes[docId] || undefined }), {
    invalidate: [['driver-detail', driverId]],
    success: 'Document reviewed',
  });
  if (q.isLoading || !q.data) return <Spinner />;
  return (
    <DataTable
      rows={q.data.documents}
      rowKey={(d) => d.id}
      empty="No documents uploaded"
      columns={[
        { header: 'Type', cell: (d) => humanize(d.type) },
        { header: 'File', cell: (d) => <button className="text-brand-700 hover:underline" onClick={() => openPrivateFile(`/drivers/documents/${d.id}/file`).catch((e) => toast.error(e))}>View</button> },
        { header: 'Status', cell: (d) => <StatusBadge status={d.status} /> },
        { header: 'Note', cell: (d) => <Input label="Note" className="min-w-40" value={notes[d.id] ?? d.reviewNote ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))} /> },
        {
          header: 'Review',
          cell: (d) => (
            <div className="flex gap-1">
              <Button size="sm" onClick={() => review.mutate({ docId: d.id, status: 'APPROVED' })}>Approve</Button>
              <Button size="sm" variant="secondary" onClick={() => review.mutate({ docId: d.id, status: 'REJECTED' })}>Reject</Button>
            </div>
          ),
        },
      ]}
    />
  );
}

export default function DriversPage() {
  const { id } = useCommunity();
  const q = useApi<DriverRow[]>(['community', id, 'drivers'], `/communities/${id}/drivers`);
  const [open, setOpen] = useState<DriverRow | null>(null);
  return (
    <div>
      <PageHeader title="Drivers" subtitle="Members of this community. Documents are visible only to authorised administrators; every view is logged." />
      <Card>
        <QueryState query={q}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              empty="No member drivers yet"
              columns={[
                { header: 'Driver', cell: (r) => <><p className="font-medium">{r.user.name}</p><p className="text-xs text-stone-500">{r.user.phone}</p></> },
                { header: 'Membership', cell: (r) => <StatusBadge status={r.membershipStatus} /> },
                { header: 'Verification', cell: (r) => <StatusBadge status={r.verificationStatus} /> },
                { header: 'Licence expiry', cell: (r) => date(r.licenseExpiry) },
                { header: 'Vehicle', cell: (r) => r.vehicleAssignments.map((a) => `${a.vehicle.registrationNumber} (${a.vehicle.status.toLowerCase()}, ${a.vehicle.seatCapacity} seats)`).join(', ') || '—' },
                { header: 'Rating', cell: (r) => (r.ratingCount ? `${(r.ratingSum / r.ratingCount).toFixed(1)} ★ (${r.ratingCount})` : '—') },
                { header: 'Now', cell: (r) => <StatusBadge status={r.availability?.communityId === id ? r.availability.status : 'OFFLINE'} /> },
                { header: '', cell: (r) => <Button size="sm" variant="secondary" onClick={() => setOpen(r)}>Documents</Button> },
              ]}
            />
          )}
        </QueryState>
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.user.name} — documents` : ''}>
        {open && <DocumentsReview driverId={open.id} communityId={id} />}
      </Modal>
    </div>
  );
}
