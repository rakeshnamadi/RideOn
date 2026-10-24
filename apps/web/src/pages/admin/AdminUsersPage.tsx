import { useState } from 'react';
import { useAuth } from '@/app/auth';
import { Button, Card, ConfirmDialog, DataTable, ErrorState, Input, PageHeader, Pagination, Spinner, StatusBadge, Textarea } from '@/components/ui';
import { useAction, useApiPage } from '@/hooks/api';
import { api } from '@/services/api';
import { dateTime, humanize } from '@/utils/format';

interface UserRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: string;
  suspensionReason: string | null;
  roles: string[];
  createdAt: string;
  lastLoginAt: string | null;
}

export default function AdminUsersPage() {
  const { me } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useApiPage<UserRow>(['admin', 'users'], '/admin/users', { search, page });
  const [target, setTarget] = useState<{ u: UserRow; status: string } | null>(null);
  const [reason, setReason] = useState('');
  const change = useAction(() => api.post(`/admin/users/${target!.u.id}/status`, { status: target!.status, reason }), { invalidate: [['admin', 'users']], success: 'Account updated; sessions revoked where applicable', onSuccess: () => { setTarget(null); setReason(''); } });
  return (
    <div>
      <PageHeader title="Users" subtitle="Suspending an account signs it out everywhere immediately." />
      <Card>
        <Input label="Search name, phone or email" className="mb-4 max-w-sm" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : (
          <>
            <DataTable
              rows={q.data?.data ?? []}
              rowKey={(r) => r.id}
              columns={[
                { header: 'Name', cell: (r) => <><p className="font-medium">{r.name}</p><p className="text-xs text-stone-500">{r.phone}{r.email ? ` · ${r.email}` : ''}</p></> },
                { header: 'Roles', cell: (r) => <span className="text-xs">{r.roles.map(humanize).join(', ')}</span> },
                { header: 'Status', cell: (r) => <><StatusBadge status={r.status} />{r.suspensionReason && <p className="text-xs text-stone-500">{r.suspensionReason}</p>}</> },
                { header: 'Last login', cell: (r) => dateTime(r.lastLoginAt) },
                {
                  header: '',
                  cell: (r) =>
                    r.id !== me?.id && (
                      <div className="flex gap-1">
                        {r.status === 'ACTIVE' ? <Button size="sm" variant="secondary" onClick={() => setTarget({ u: r, status: 'SUSPENDED' })}>Suspend</Button> : <Button size="sm" onClick={() => setTarget({ u: r, status: 'ACTIVE' })}>Reactivate</Button>}
                      </div>
                    ),
                },
              ]}
            />
            <Pagination page={page} totalPages={Number(q.data?.meta?.totalPages ?? 1)} onPage={setPage} />
          </>
        )}
      </Card>
      <ConfirmDialog open={!!target} title={`${target?.status === 'ACTIVE' ? 'Reactivate' : 'Suspend'} ${target?.u.name}?`} message={target?.status === 'ACTIVE' ? 'The user can sign in again.' : 'The user is signed out of every device and cannot sign in until reactivated.'} confirmLabel="Confirm" tone={target?.status === 'ACTIVE' ? 'primary' : 'danger'} loading={change.isPending} onClose={() => setTarget(null)} onConfirm={() => change.mutate()}>
        <Textarea label="Reason (recorded)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
