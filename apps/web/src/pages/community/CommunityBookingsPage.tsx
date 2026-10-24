import { useState } from 'react';
import { Card, DataTable, ErrorState, PageHeader, Pagination, Select, Spinner, StatusBadge } from '@/components/ui';
import { useApiPage } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { dateTime, humanize, inr } from '@/utils/format';

export interface BookingRow {
  id: string;
  reference: string;
  type: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  seatCount?: number;
  pickupAddress?: string | null;
  dropAddress?: string | null;
  quotedFarePaise: number;
  finalFarePaise: number | null;
  cancellationFeePaise?: number;
  cancelReason?: string | null;
  createdAt: string;
  passenger: { name: string };
  driver: { user: { name: string } } | null;
  community?: { name: string };
}

const STATUSES = ['', 'REQUESTED', 'CONFIRMED', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_DRIVER_AVAILABLE', 'NO_SHOW'];

export function BookingsTable({ rows, showCommunity }: { rows: BookingRow[]; showCommunity?: boolean }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      empty="No bookings match"
      columns={[
        { header: 'When', cell: (r) => dateTime(r.createdAt) },
        { header: 'Ref', cell: (r) => r.reference },
        ...(showCommunity ? [{ header: 'Community', cell: (r: BookingRow) => r.community?.name ?? '—' }] : []),
        { header: 'Type', cell: (r) => `${humanize(r.type)}${r.seatCount && r.seatCount > 1 ? ` ×${r.seatCount}` : ''}` },
        { header: 'Passenger', cell: (r) => r.passenger.name.split(' ')[0] },
        { header: 'Driver', cell: (r) => r.driver?.user.name ?? '—' },
        { header: 'Status', cell: (r) => <><StatusBadge status={r.status} />{r.cancelReason && <p className="text-xs text-stone-500">{r.cancelReason}</p>}</> },
        { header: 'Fare', cell: (r) => inr(r.finalFarePaise ?? r.quotedFarePaise), className: 'text-right tabular-nums' },
        { header: 'Payment', cell: (r) => <StatusBadge status={r.paymentStatus} /> },
      ]}
    />
  );
}

export default function CommunityBookingsPage() {
  const { id } = useCommunity();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const q = useApiPage<BookingRow>(['community', id, 'bookings'], `/communities/${id}/bookings`, { page, status, type });
  return (
    <div>
      <PageHeader title="Bookings" />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={STATUSES.map((s) => ({ value: s, label: s ? humanize(s) : 'All' }))} />
          <Select label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} options={[{ value: '', label: 'All' }, { value: 'REGULAR', label: 'Regular' }, { value: 'SHARED', label: 'Shared' }]} />
        </div>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <>
            <BookingsTable rows={q.data?.data ?? []} />
            <Pagination page={page} totalPages={Number(q.data?.meta?.totalPages ?? 1)} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
