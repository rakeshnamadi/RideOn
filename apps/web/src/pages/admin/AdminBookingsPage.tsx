import { useState } from 'react';
import { Card, ErrorState, Input, PageHeader, Pagination, Select, Spinner } from '@/components/ui';
import { useApi, useApiPage } from '@/hooks/api';
import { humanize } from '@/utils/format';
import { BookingsTable, type BookingRow } from '../community/CommunityBookingsPage';

const STATUSES = ['', 'REQUESTED', 'CONFIRMED', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_DRIVER_AVAILABLE', 'NO_SHOW'];

export default function AdminBookingsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [reference, setReference] = useState('');
  const communities = useApi<{ id: string; name: string }[]>(['admin', 'communities', ''], '/admin/communities');
  const q = useApiPage<BookingRow>(['admin', 'bookings'], '/admin/bookings', { page, status, communityId, reference });
  return (
    <div>
      <PageHeader title="All bookings" />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input label="Reference" value={reference} onChange={(e) => { setReference(e.target.value); setPage(1); }} placeholder="RO-…" />
          <Select label="Community" value={communityId} onChange={(e) => { setCommunityId(e.target.value); setPage(1); }} options={[{ value: '', label: 'All' }, ...(communities.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={STATUSES.map((s) => ({ value: s, label: s ? humanize(s) : 'All' }))} />
        </div>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <>
            <BookingsTable rows={q.data?.data ?? []} showCommunity />
            <Pagination page={page} totalPages={Number(q.data?.meta?.totalPages ?? 1)} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
