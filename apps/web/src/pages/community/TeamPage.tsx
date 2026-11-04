import { useState } from 'react';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, Input, Modal, PageHeader, QueryState, Select, StatusBadge } from '@/components/ui';
import { UNION_ROLE_HELP, UNION_ROLE_LABELS } from '@/features/union/roles';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';

interface Member {
  id: string;
  role: string;
  active: boolean;
  permissions: string[];
  customPermissions: string[] | null;
  user: { id: string; name: string; phone: string };
}
interface Catalog {
  permissions: { key: string; label: string; delegable: boolean }[];
  roleDefaults: Record<string, string[]>;
  assignableRoles: string[];
}

const roleOptions = (roles: string[]) => roles.map((r) => ({ value: r, label: UNION_ROLE_LABELS[r] ?? r }));

function EditMember({ member, catalog, onClose }: { member: Member; catalog: Catalog; onClose: () => void }) {
  const { id } = useCommunity();
  const [role, setRole] = useState(member.role);
  const [custom, setCustom] = useState(member.customPermissions !== null);
  const [selected, setSelected] = useState<string[]>(member.permissions);
  const save = useAction(() => api.patch(`/communities/${id}/admins/${member.id}`, { role, permissions: custom && role !== 'LOCAL_ADMIN' ? selected : null }), { invalidate: [['community', id, 'admins']], success: 'Access updated. It applies on their next action.', onSuccess: onClose });
  const defaults = catalog.roleDefaults[role] ?? [];
  const effective = custom ? selected : defaults;
  const pickRole = (r: string) => {
    setRole(r);
    if (custom) setSelected(catalog.roleDefaults[r] ?? []);
  };
  return (
    <Modal open onClose={onClose} title={`Access for ${member.user.name}`} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Save access</Button>}>
      <div className="space-y-4">
        <Select label="Role" value={role} onChange={(e) => pickRole(e.target.value)} options={roleOptions(catalog.assignableRoles)} hint={UNION_ROLE_HELP[role]} />
        {role !== 'LOCAL_ADMIN' && (
          <>
            <Checkbox label="Choose individual permissions instead of the role’s defaults" checked={custom} onChange={(e) => { setCustom(e.target.checked); setSelected(defaults); }} />
            <ul className="space-y-1.5 rounded-lg border border-line p-3">
              {catalog.permissions.filter((p) => p.delegable).map((p) => (
                <li key={p.key}>
                  <Checkbox
                    label={p.label}
                    disabled={!custom || p.key === 'community.view'}
                    checked={effective.includes(p.key)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, p.key] : selected.filter((k) => k !== p.key))}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Who holds which role in this union. Local admins delegate the roles below them. */
export default function TeamPage() {
  const { id, community } = useCommunity();
  const catalog = useApi<Catalog>(['community', id, 'team-catalog'], `/communities/${id}/team-catalog`);
  const team = useApi<Member[]>(['community', id, 'admins'], `/communities/${id}/admins`);
  const assignable = catalog.data?.assignableRoles ?? [];
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('REPORTER');
  const inv = [['community', id, 'admins']];
  const add = useAction(() => api.post(`/communities/${id}/admins`, { phone, role }), { invalidate: inv, success: 'Role assigned', onSuccess: () => setPhone('') });
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const remove = useAction(() => api.del(`/communities/${id}/admins/${removing!.id}`), { invalidate: inv, success: 'Access removed', onSuccess: () => setRemoving(null) });

  return (
    <div className="space-y-5">
      <PageHeader title="Team & permissions" subtitle={`Give people access to ${community.name}. Each person sees only what their role allows.`} />
      <Card>
        <QueryState query={team}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              columns={[
                { header: 'Name', cell: (r) => <><p className="font-medium">{r.user.name}</p><p className="text-xs text-muted">{r.user.phone}</p></> },
                { header: 'Role', cell: (r) => <>{UNION_ROLE_LABELS[r.role] ?? r.role}{r.customPermissions && <span className="ml-2"><Badge tone="blue">Custom</Badge></span>}</> },
                { header: 'Permissions', cell: (r) => <span className="text-xs text-muted">{r.permissions.length} of {catalog.data?.permissions.length ?? '—'}</span> },
                { header: 'Status', cell: (r) => <StatusBadge status={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
                {
                  header: '',
                  cell: (r) =>
                    r.active && assignable.includes(r.role) && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Edit access</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>Remove</Button>
                      </div>
                    ),
                },
              ]}
            />
          )}
        </QueryState>
        {assignable.length > 0 && (
          <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <Input label="Mobile number of a registered person" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)} options={roleOptions(assignable)} />
            <Button type="submit" disabled={phone.length < 10} loading={add.isPending}>Assign role</Button>
          </form>
        )}
      </Card>
      <Card title="What each role can do">
        <ul className="space-y-2 text-sm">
          {Object.keys(UNION_ROLE_LABELS).map((r) => (
            <li key={r}><span className="font-medium">{UNION_ROLE_LABELS[r]}.</span> <span className="text-muted">{UNION_ROLE_HELP[r]}</span></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Local admins are appointed by the platform’s super admin. Only a local admin can manage the team or change operational settings.</p>
      </Card>
      {editing && catalog.data && <EditMember member={editing} catalog={catalog.data} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} title={`Remove ${removing?.user.name}?`} message="They lose access to this union’s console immediately." confirmLabel="Remove" tone="danger" loading={remove.isPending} onClose={() => setRemoving(null)} onConfirm={() => remove.mutate()} />
    </div>
  );
}
