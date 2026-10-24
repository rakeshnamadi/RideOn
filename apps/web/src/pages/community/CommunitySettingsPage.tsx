import { useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, ConfirmDialog, DataTable, Input, PageHeader, QueryState, Select, StatusBadge, Textarea } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';
import { humanize, inr, rupeesToPaise } from '@/utils/format';

interface Policy {
  fareApprovalMode: string;
  requiredApprovals: number;
  allowSelfApproval: boolean;
  maxFareIncreasePercent: number;
  minNoticeHours: number;
  allowDistanceFares: boolean;
  communityFeeBps: number;
  cancellationFreeWindowSec: number;
  cancellationFeePaise: number;
  driverOfferTimeoutSec: number;
  bookingRequestTimeoutSec: number;
  seatHoldMinutes: number;
}
interface Admin {
  id: string;
  role: string;
  active: boolean;
  user: { id: string; name: string; phone: string };
}

function PolicyForm({ policy, editable }: { policy: Policy; editable: boolean }) {
  const { id } = useCommunity();
  const [p, setP] = useState(policy);
  useEffect(() => setP(policy), [policy]);
  const save = useAction(
    () =>
      api.put(`/communities/${id}/policy`, {
        fareApprovalMode: p.fareApprovalMode,
        requiredApprovals: p.requiredApprovals,
        allowSelfApproval: p.allowSelfApproval,
        minNoticeHours: p.minNoticeHours,
        cancellationFreeWindowSec: p.cancellationFreeWindowSec,
        cancellationFeePaise: p.cancellationFeePaise,
        driverOfferTimeoutSec: p.driverOfferTimeoutSec,
        bookingRequestTimeoutSec: p.bookingRequestTimeoutSec,
        seatHoldMinutes: p.seatHoldMinutes,
      }),
    { invalidate: [['community', id]], success: 'Policy saved (recorded in decision history)' },
  );
  const num = (k: keyof Policy) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
        <Select label="Fare approval" value={p.fareApprovalMode} onChange={(e) => setP({ ...p, fareApprovalMode: e.target.value })} options={[{ value: 'SINGLE_APPROVER', label: 'One authorised approver' }, { value: 'MULTI_APPROVER', label: 'Several approvers' }, { value: 'PLATFORM_REVIEW', label: 'Approvers + platform review' }]} />
        <Input label="Approvals required" type="number" min={1} max={10} value={p.requiredApprovals} onChange={num('requiredApprovals')} disabled={p.fareApprovalMode === 'SINGLE_APPROVER'} />
        <Checkbox className="sm:col-span-2" label="Allow a proposer to approve their own proposal" checked={p.allowSelfApproval} onChange={(e) => setP({ ...p, allowSelfApproval: e.target.checked })} />
        <Input label="Minimum notice for fare changes (hours)" type="number" min={0} value={p.minNoticeHours} onChange={num('minNoticeHours')} />
        <Input label="Free cancellation after acceptance (seconds)" type="number" min={0} value={p.cancellationFreeWindowSec} onChange={num('cancellationFreeWindowSec')} />
        <Input label="Cancellation fee (₹)" type="number" min={0} step="1" value={p.cancellationFeePaise / 100} onChange={(e) => setP({ ...p, cancellationFeePaise: rupeesToPaise(Number(e.target.value)) })} />
        <Input label="Driver offer timeout (seconds)" type="number" min={10} value={p.driverOfferTimeoutSec} onChange={num('driverOfferTimeoutSec')} />
        <Input label="Booking request timeout (seconds)" type="number" min={60} value={p.bookingRequestTimeoutSec} onChange={num('bookingRequestTimeoutSec')} />
        <Input label="Shared seat hold (minutes)" type="number" min={1} value={p.seatHoldMinutes} onChange={num('seatHoldMinutes')} />
      </fieldset>
      <Alert tone="info">
        Set by the platform: max fare increase without review {policy.maxFareIncreasePercent}% · distance fares {policy.allowDistanceFares ? 'allowed' : 'not allowed'} · community fee {policy.communityFeeBps / 100}% of each fare. Current cancellation fee {inr(policy.cancellationFeePaise)}.
      </Alert>
      {editable && <Button type="submit" loading={save.isPending}>Save policy</Button>}
    </form>
  );
}

export default function CommunitySettingsPage() {
  const { id, community, can } = useCommunity();
  const policy = useApi<Policy>(['community', id, 'policy'], `/communities/${id}/policy`);
  const admins = useApi<Admin[]>(['community', id, 'admins'], `/communities/${id}/admins`);
  const [profile, setProfile] = useState({ name: community.name, description: String(community.description ?? ''), contactPhone: String(community.contactPhone ?? '') });
  const saveProfile = useAction(() => api.patch(`/communities/${id}`, { name: profile.name, description: profile.description || null, contactPhone: profile.contactPhone || null }), { invalidate: [['community', id]], success: 'Profile saved' });
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('ADMIN');
  const addAdmin = useAction(() => api.post(`/communities/${id}/admins`, { phone, role }), { invalidate: [['community', id, 'admins']], success: 'Role assigned', onSuccess: () => setPhone('') });
  const [removing, setRemoving] = useState<Admin | null>(null);
  const removeAdmin = useAction(() => api.del(`/communities/${id}/admins/${removing!.id}`), { invalidate: [['community', id, 'admins']], success: 'Role removed', onSuccess: () => setRemoving(null) });

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Community profile">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveProfile.mutate(); }}>
            <fieldset disabled={!can('profile.edit')} className="space-y-3">
              <Input label="Name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
              <Textarea label="Description" value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} />
              <Input label="Public contact phone" value={profile.contactPhone} onChange={(e) => setProfile({ ...profile, contactPhone: e.target.value })} />
            </fieldset>
            {can('profile.edit') && <Button type="submit" loading={saveProfile.isPending}>Save profile</Button>}
          </form>
        </Card>
        <Card title="Governance & operating policy">
          <QueryState query={policy}>{(p) => <PolicyForm policy={p} editable={can('policy.edit')} />}</QueryState>
        </Card>
      </div>
      <Card title="Administrators">
        <QueryState query={admins}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              columns={[
                { header: 'Name', cell: (r) => r.user.name },
                { header: 'Phone', cell: (r) => r.user.phone },
                { header: 'Role', cell: (r) => humanize(r.role) },
                { header: 'Status', cell: (r) => <StatusBadge status={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
                { header: '', cell: (r) => can('admins.manage') && r.active && <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>Remove</Button> },
              ]}
            />
          )}
        </QueryState>
        {can('admins.manage') && (
          <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-stone-200 pt-4" onSubmit={(e) => { e.preventDefault(); addAdmin.mutate(); }}>
            <Input label="Mobile number of an existing user" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)} options={['HEAD', 'ADMIN', 'APPROVER', 'OPERATOR'].map((r) => ({ value: r, label: humanize(r) }))} />
            <Button type="submit" disabled={phone.length < 10} loading={addAdmin.isPending}>Assign role</Button>
          </form>
        )}
        <p className="mt-3 text-xs text-stone-500">Head: everything. Admin: operations and fare proposals. Approver: votes on fare proposals. Operator: live queue, bookings and complaints.</p>
      </Card>
      <ConfirmDialog open={!!removing} title={`Remove ${removing?.user.name}?`} message="They lose access to this community's console immediately." confirmLabel="Remove" loading={removeAdmin.isPending} onClose={() => setRemoving(null)} onConfirm={() => removeAdmin.mutate()} />
    </div>
  );
}
