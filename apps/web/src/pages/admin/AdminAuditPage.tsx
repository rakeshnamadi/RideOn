import { useState } from 'react';
import { Card, ErrorState, Input, PageHeader, Pagination, Spinner } from '@/components/ui';
import { AuditTable, type AuditRow } from '@/features/audit/AuditTable';
import { useApiPage } from '@/hooks/api';

export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const q = useApiPage<AuditRow>(['admin', 'audit'], '/admin/audit-logs', { page, action, entityId });
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Append-only. Updates and deletions are blocked by the database." />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input label="Action contains" placeholder="fare." value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          <Input label="Record ID" value={entityId} onChange={(e) => { setEntityId(e.target.value); setPage(1); }} />
        </div>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : (
          <>
            <AuditTable rows={q.data?.data ?? []} />
            <Pagination page={page} totalPages={Number(q.data?.meta?.totalPages ?? 1)} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
