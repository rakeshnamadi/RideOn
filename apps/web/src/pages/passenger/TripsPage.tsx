import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner, StatusBadge } from '@/components/ui';
import { useApiPage } from '@/hooks/api';
import { useT, type MessageKey } from '@/i18n';
import { useLiveInterval } from '@/services/socket';
import { dateTime, inr } from '@/utils/format';
import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/services/socket';

interface Row {
  id: string;
  reference: string;
  type: 'REGULAR' | 'SHARED';
  status: string;
  paymentStatus: string;
  pickupAddress: string | null;
  dropAddress: string | null;
  quotedFarePaise: number;
  finalFarePaise: number | null;
  seatCount: number;
  createdAt: string;
  tripInstance: { departureAt: string; route: { code: string; name: string } } | null;
  community: { name: string };
}

export default function TripsPage() {
  const { t } = useT();
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  useLiveInterval(10_000);
  useSocketEvent('booking:updated', () => qc.invalidateQueries({ queryKey: ['bookings'] }));
  const q = useApiPage<Row>(['bookings', 'mine'], '/bookings', { page });
  return (
    <div>
      <PageHeader title={t('nav.trips')} />
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState title="No trips yet" action={<Link to="/app" className="font-medium text-brand-700 hover:underline">Book your first ride</Link>} />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {q.data.data.map((b) => (
              <li key={b.id}>
                <Link to={`/app/bookings/${b.id}`} className="flex items-center gap-3 py-3 hover:bg-stone-50">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {b.type === 'SHARED' ? `Shared ${b.tripInstance?.route.code} · ${b.seatCount} seat${b.seatCount > 1 ? 's' : ''}` : 'Auto'}
                      <StatusBadge status={b.status} label={t(`status.${b.status}` as MessageKey)} />
                    </p>
                    <p className="truncate text-sm text-stone-600">
                      {b.pickupAddress ?? 'Pickup'} → {b.dropAddress ?? 'Destination'}
                    </p>
                    <p className="text-xs text-stone-500">
                      {b.reference} · {dateTime(b.tripInstance?.departureAt ?? b.createdAt)} · {b.community.name}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">{inr(b.finalFarePaise ?? b.quotedFarePaise)}</span>
                  <ChevronRight className="size-4 text-stone-400" />
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={Number(q.data.meta?.totalPages ?? 1)} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}
