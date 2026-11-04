import { useState } from 'react';
import { useAuth } from '@/app/auth';
import { Button, Card, Checkbox, ConfirmDialog, DataTable, ErrorState, Input, Modal, PageHeader, Pagination, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';
import { PLATFORM_ROLE_HELP, UNION_ROLE_HELP, UNION_ROLE_LABELS } from '@/features/union/roles';
import { useAction, useApi, useApiPage } from '@/hooks/api';
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
  communityAdminRoles: { id: string; role: string; community: { id: string; name: string } }[];
}

function ManageRoles({ user, isSelf, onClose }: { user: UserRow; isSelf: boolean; onClose: () => void }) {
  const inv = [['admin', 'users']];
  const [roles, setRoles] = useState(user.roles);
  const saveRoles = useAction(() => api.put(`/admin/users/${user.id}/roles`, { roles }), { invalidate: inv, success: 'Platform roles saved' });
  const unions = useApi<{ id: string; name: string }[]>(['admin', 'communities', ''], '/admin/communities');
  const [communityId, setCommunityId] = useState('');
  const [role, setRole] = useState('LOCAL_ADMIN');
  const assign = useAction(() => api.post(`/admin/users/${user.id}/community-roles`, { communityId, role }), { invalidate: [...inv, ['admin', 'communities']], success: 'Union role assigned', onSuccess: () => setCommunityId('') });
  const unassign = useAction((id: string) => api.del(`/admin/users/${user.id}/community-roles/${id}`), { invalidate: [...inv, ['admin', 'communities']], success: 'Union role removed' });
  return (
    <Modal open onClose={onClose} title={`Roles for ${user.name}`}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Platform roles</h3>
          <ul className="space-y-2">
            {Object.entries(PLATFORM_ROLE_HELP).map(([key, help]) => (
              <li key={key}>
                <Checkbox
                  label={<><span className="font-medium">{humanize(key)}</span> <span className="text-muted">{help}</span></>}
                  checked={roles.includes(key)}
                  disabled={isSelf && key === 'SUPER_ADMIN'}
                  onChange={(e) => setRoles(e.target.checked ? [...roles, key] : roles.filter((r) => r !== key))}
                />
              </li>
            ))}
          </ul>
          <Button className="mt-3" size="sm" disabled={roles.length === 0} loading={saveRoles.isPending} onClick={() => saveRoles.mutate()}>Save platform roles</Button>
        </section>
        <section className="border-t border-line pt-4">
          <h3 className="mb-2 text-sm font-semibold">Union roles</h3>
          {user.communityAdminRoles.length === 0 && <p className="text-sm text-muted">No union roles yet.</p>}
          <ul className="space-y-1.5">
            {user.communityAdminRoles.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{UNION_ROLE_LABELS[a.role] ?? a.role} · {a.community.name}</span>
                <Button size="sm" variant="ghost" loading={unassign.isPending} onClick={() => unassign.mutate(a.id)}>Remove</Button>
              </li>
            ))}
          </ul>
          <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); assign.mutate(); }}>
            <Select label="Union" value={communityId} onChange={(e) => setCommunityId(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...(unions.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
            <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)} options={Object.entries(UNION_ROLE_LABELS).map(([value, label]) => ({ value, label }))} hint={UNION_ROLE_HELP[role]} />
            <Button type="submit" size="sm" disabled={!communityId} loading={assign.isPending}>Assign union role</Button>
          </form>
        </section>
      </div>
    </Modal>
  );
}

export default function AdminUsersPage() {
  const { me } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useApiPage<UserRow>(['admin', 'users'], '/admin/users', { search, page });
  const [target, setTarget] = useState<{ u: UserRow; status: string } | null>(null);
  const [reason, setReason] = useState('');
  const [managing, setManaging] = useState<string | null>(null);
  const managed = q.data?.data.find((u) => u.id === managing) ?? null;
  const change = useAction(() => api.post(`/admin/users/${target!.u.id}/status`, { status: target!.status, reason }), { invalidate: [['admin', 'users']], success: 'Account updated; sessions revoked where applicable', onSuccess: () => { setTarget(null); setReason(''); } });
  return (
    <div>
      <PageHeader title="Users & roles" subtitle="Assign platform and union roles to anyone who has registered. Suspending an account signs it out everywhere immediately." />
      <Card>
        <Input label="Search name, phone or email" className="mb-4 max-w-sm" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : (
          <>
            <DataTable
              rows={q.data?.data ?? []}
              rowKey={(r) => r.id}
              columns={[
                { header: 'Name', cell: (r) => <><p className="font-medium">{r.name}</p><p className="text-xs text-stone-500">{r.phone}{r.email ? ` · ${r.email}` : ''}</p></> },
                { header: 'Roles', cell: (r) => <div className="text-xs"><p>{r.roles.map(humanize).join(', ')}</p>{r.communityAdminRoles.map((a) => <p key={a.id} className="text-muted">{UNION_ROLE_LABELS[a.role] ?? a.role} · {a.community.name}</p>)}</div> },
                { header: 'Status', cell: (r) => <><StatusBadge status={r.status} />{r.suspensionReason && <p className="text-xs text-stone-500">{r.suspensionReason}</p>}</> },
                { header: 'Last login', cell: (r) => dateTime(r.lastLoginAt) },
                {
                  header: '',
                  cell: (r) => (
                    <div className="flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setManaging(r.id)}>Manage roles</Button>
                      {r.id !== me?.id && (r.status === 'ACTIVE' ? <Button size="sm" variant="ghost" onClick={() => setTarget({ u: r, status: 'SUSPENDED' })}>Suspend</Button> : <Button size="sm" onClick={() => setTarget({ u: r, status: 'ACTIVE' })}>Reactivate</Button>)}
                    </div>
                  ),
                },
              ]}
            />
            <Pagination page={page} totalPages={Number(q.data?.meta?.totalPages ?? 1)} onPage={setPage} />
          </>
        )}
      </Card>
      {managed && <ManageRoles key={managed.id} user={managed} isSelf={managed.id === me?.id} onClose={() => setManaging(null)} />}
      <ConfirmDialog open={!!target} title={`${target?.status === 'ACTIVE' ? 'Reactivate' : 'Suspend'} ${target?.u.name}?`} message={target?.status === 'ACTIVE' ? 'The user can sign in again.' : 'The user is signed out of every device and cannot sign in until reactivated.'} confirmLabel="Confirm" tone={target?.status === 'ACTIVE' ? 'primary' : 'danger'} loading={change.isPending} onClose={() => setTarget(null)} onConfirm={() => change.mutate()}>
        <Textarea label="Reason (recorded)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
