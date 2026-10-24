import { useState } from 'react';
import { Card, DataTable, ErrorState, PageHeader, Pagination, Spinner, StatusBadge } from '@/components/ui';
import { useApiPage } from '@/hooks/api';
import { dateTime, inr } from '@/utils/format';

interface Row {
  id: string;
  reference: string;
  type: string;
  status: string;
  pickupAddress: string | null;
  dropAddress: string | null;
  quotedFarePaise: number;
  finalFarePaise: number | null;
  driverEarningsPaise: number | null;
  platformFeePaise: number | null;
  communityFeePaise: number | null;
  paymentStatus: string;
  createdAt: string;
  seatCount: number;
}

export default function DriverHistoryPage() {
  const [page, setPage] = useState(1);
  const q = useApiPage<Row>(['driver', 'trips', 'history'], '/drivers/me/trips', { page });
  return (
    <div>
      <PageHeader title="Trip history" />
      <Card>
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            <DataTable
              rows={q.data?.data ?? []}
              rowKey={(r) => r.id}
              empty="No trips yet"
              columns={[
                { header: 'When', cell: (r) => dateTime(r.createdAt) },
                { header: 'Ref', cell: (r) => r.reference },
                { header: 'Trip', cell: (r) => <span className="line-clamp-2 max-w-xs">{r.pickupAddress ?? '—'} → {r.dropAddress ?? '—'}</span> },
                { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                { header: 'Fare', cell: (r) => inr(r.finalFarePaise ?? r.quotedFarePaise), className: 'text-right tabular-nums' },
                { header: 'Fees', cell: (r) => (r.platformFeePaise !== null ? inr((r.platformFeePaise ?? 0) + (r.communityFeePaise ?? 0)) : '—'), className: 'text-right tabular-nums' },
                { header: 'Your net', cell: (r) => inr(r.driverEarningsPaise), className: 'text-right tabular-nums font-medium' },
                { header: 'Payment', cell: (r) => <StatusBadge status={r.paymentStatus} /> },
              ]}
            />
            <Pagination page={page} totalPages={Number(q.data?.meta?.totalPages ?? 1)} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
