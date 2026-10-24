import { useState } from 'react';
import { AuditTable, type AuditRow } from '@/features/audit/AuditTable';
import { Card, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';
import { useApiPage } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';

export default function CommunityAuditPage() {
  const { id } = useCommunity();
  const [page, setPage] = useState(1);
  const q = useApiPage<AuditRow>(['community', id, 'audit'], `/communities/${id}/audit-logs`, { page });
  return (
    <div>
      <PageHeader title="Decision history" subtitle="Append-only record of every administrative action in this community. Entries cannot be edited or deleted." />
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <>
            <AuditTable rows={q.data?.data ?? []} />
            <Pagination page={page} totalPages={Number(q.data?.meta?.totalPages ?? 1)} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
