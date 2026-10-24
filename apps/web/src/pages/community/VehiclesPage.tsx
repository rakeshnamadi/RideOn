import { useState } from 'react';
import { Button, Card, ConfirmDialog, DataTable, Input, PageHeader, QueryState, StatusBadge, Tabs, Textarea } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';
import { date } from '@/utils/format';

interface Vehicle {
  id: string;
  registrationNumber: string;
  make: string;
  model: string;
  color: string | null;
  fuelType: string | null;
  seatCapacity: number;
  permitNumber: string | null;
  permitExpiry: string | null;
  insuranceExpiry: string | null;
  status: string;
  reviewNote: string | null;
  assignments: { driver: { id: string; user: { name: string } } }[];
}

export default function VehiclesPage() {
  const { id } = useCommunity();
  const [tab, setTab] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'INACTIVE'>('PENDING');
  const q = useApi<Vehicle[]>(['community', id, 'vehicles', tab], `/communities/${id}/vehicles`, { status: tab });
  const [action, setAction] = useState<{ v: Vehicle; decision: 'APPROVE' | 'REJECT' | 'DEACTIVATE' } | null>(null);
  const [capacity, setCapacity] = useState(3);
  const [note, setNote] = useState('');
  const decide = useAction(
    () => api.post(`/communities/${id}/vehicles/${action!.v.id}/decision`, { decision: action!.decision, note: note || undefined, ...(action!.decision === 'APPROVE' ? { seatCapacity: capacity } : {}) }),
    { invalidate: [['community', id]], success: 'Vehicle updated', onSuccess: () => { setAction(null); setNote(''); } },
  );
  return (
    <div>
      <PageHeader title="Vehicles" subtitle="Approve vehicles and set the permit-bound passenger capacity. Drivers cannot change capacity." />
      <Tabs value={tab} onChange={setTab} options={[{ value: 'PENDING', label: 'To review' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }, { value: 'INACTIVE', label: 'Inactive' }]} />
      <Card>
        <QueryState query={q}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              empty="No vehicles"
              columns={[
                { header: 'Registration', cell: (r) => <><p className="font-medium">{r.registrationNumber}</p><p className="text-xs text-stone-500">{r.make} {r.model} {r.color ? `· ${r.color}` : ''} {r.fuelType ? `· ${r.fuelType}` : ''}</p></> },
                { header: 'Driver', cell: (r) => r.assignments.map((a) => a.driver.user.name).join(', ') || '—' },
                { header: 'Permit', cell: (r) => <>{r.permitNumber ?? '—'}<p className="text-xs text-stone-500">expires {date(r.permitExpiry)}</p></> },
                { header: 'Insurance', cell: (r) => date(r.insuranceExpiry) },
                { header: 'Seats', cell: (r) => r.seatCapacity },
                { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                {
                  header: '',
                  cell: (r) => (
                    <div className="flex gap-1">
                      {r.status !== 'APPROVED' && <Button size="sm" onClick={() => { setCapacity(r.seatCapacity); setAction({ v: r, decision: 'APPROVE' }); }}>Approve</Button>}
                      {r.status === 'PENDING' && <Button size="sm" variant="secondary" onClick={() => setAction({ v: r, decision: 'REJECT' })}>Reject</Button>}
                      {r.status === 'APPROVED' && <Button size="sm" variant="secondary" onClick={() => setAction({ v: r, decision: 'DEACTIVATE' })}>Deactivate</Button>}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </QueryState>
      </Card>
      <ConfirmDialog
        open={!!action}
        title={action ? `${action.decision === 'APPROVE' ? 'Approve' : action.decision === 'REJECT' ? 'Reject' : 'Deactivate'} ${action.v.registrationNumber}` : ''}
        tone={action?.decision === 'APPROVE' ? 'primary' : 'danger'}
        loading={decide.isPending}
        onClose={() => setAction(null)}
        onConfirm={() => decide.mutate()}
        message={action?.decision === 'APPROVE' ? 'Confirm you have checked the RC, permit and insurance. Set the passenger capacity the permit allows.' : 'The driver is notified.'}
      >
        {action?.decision === 'APPROVE' && <Input label="Permitted passenger seats" type="number" min={1} max={6} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />}
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
