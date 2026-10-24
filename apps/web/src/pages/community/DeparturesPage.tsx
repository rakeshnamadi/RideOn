import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, DataTable, Modal, PageHeader, QueryState, Select, StatusBadge, Textarea } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';
import { useLiveInterval } from '@/services/socket';
import { dateTime } from '@/utils/format';

interface Trip {
  id: string;
  departureAt: string;
  status: string;
  capacity: number;
  seatsBooked: number;
  route: { code: string; name: string };
  driver: { id: string; user: { name: string } } | null;
  vehicle: { registrationNumber: string } | null;
}

export default function DeparturesPage() {
  const { id, can } = useCommunity();
  const interval = useLiveInterval(15_000);
  const q = useApi<Trip[]>(['community', id, 'departures'], `/shared-trips/community/${id}`, undefined, { refetchInterval: interval });
  const drivers = useApi<{ id: string; user: { name: string }; membershipStatus: string }[]>(['community', id, 'drivers'], can('drivers.manage') ? `/communities/${id}/drivers` : null);
  const [assignFor, setAssignFor] = useState<Trip | null>(null);
  const [driverId, setDriverId] = useState('');
  const [cancelFor, setCancelFor] = useState<Trip | null>(null);
  const [reason, setReason] = useState('');
  const inv = [['community', id, 'departures']];
  const assign = useAction(() => api.post(`/shared-trips/${assignFor!.id}/assign`, { driverId }), { invalidate: inv, success: 'Driver assigned', onSuccess: () => setAssignFor(null) });
  const cancel = useAction(() => api.post<{ cancelledBookings: number }>(`/shared-trips/${cancelFor!.id}/cancel`, { reason }), {
    invalidate: inv,
    success: (r) => `Departure cancelled. ${r.cancelledBookings} passenger(s) notified and refunded where prepaid.`,
    onSuccess: () => { setCancelFor(null); setReason(''); },
  });
  return (
    <div>
      <PageHeader title="Departures" subtitle="Upcoming shared-auto runs generated from route schedules." />
      <Card>
        <QueryState query={q}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              empty="No upcoming departures — add schedules to an active route"
              columns={[
                { header: 'Departure', cell: (r) => dateTime(r.departureAt) },
                { header: 'Route', cell: (r) => <><Badge tone="blue">{r.route.code}</Badge> <span className="text-sm">{r.route.name}</span></> },
                { header: 'Seats', cell: (r) => `${r.seatsBooked}/${r.capacity}` },
                { header: 'Driver', cell: (r) => (r.driver ? `${r.driver.user.name} · ${r.vehicle?.registrationNumber}` : <span className="text-amber-700">Unassigned</span>) },
                { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                {
                  header: '',
                  cell: (r) =>
                    r.status === 'SCHEDULED' && (
                      <div className="flex gap-1">
                        {can('queue.manage') && <Button size="sm" variant="secondary" onClick={() => { setDriverId(''); setAssignFor(r); }}>{r.driver ? 'Reassign' : 'Assign'}</Button>}
                        {can('routes.manage') && <Button size="sm" variant="ghost" onClick={() => setCancelFor(r)}>Cancel</Button>}
                      </div>
                    ),
                },
              ]}
            />
          )}
        </QueryState>
      </Card>
      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title="Assign a driver" footer={<Button disabled={!driverId} loading={assign.isPending} onClick={() => assign.mutate()}>Assign</Button>}>
        <Select label="Driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...(drivers.data ?? []).filter((d) => d.membershipStatus === 'APPROVED').map((d) => ({ value: d.id, label: d.user.name }))]} hint="The driver's approved vehicle must have at least this departure's capacity." />
      </Modal>
      <ConfirmDialog open={!!cancelFor} title="Cancel this departure?" message="All passengers are notified. Online payments are refunded in full." confirmLabel="Cancel departure" loading={cancel.isPending} onClose={() => setCancelFor(null)} onConfirm={() => cancel.mutate()}>
        <Textarea label="Reason (shown to passengers)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
