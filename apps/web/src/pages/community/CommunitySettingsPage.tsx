import { useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, ConfirmDialog, DataTable, DefinitionList, Input, Modal, PageHeader, QueryState, Select, StatusBadge, Textarea } from '@/components/ui';
import { formatPolicyValue, POLICY_LABELS } from '@/features/governance/PolicyChangeSummary';
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

/** Operational settings: changed directly by whoever holds policy.edit (audited). */
function OperationalForm({ policy, editable }: { policy: Policy; editable: boolean }) {
  const { id } = useCommunity();
  const [p, setP] = useState(policy);
  useEffect(() => setP(policy), [policy]);
  const save = useAction(
    () => api.put(`/communities/${id}/policy`, { driverOfferTimeoutSec: p.driverOfferTimeoutSec, bookingRequestTimeoutSec: p.bookingRequestTimeoutSec, seatHoldMinutes: p.seatHoldMinutes }),
    { invalidate: [['community', id]], success: 'Operational settings saved (recorded in decision history)' },
  );
  const num = (k: keyof Policy) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-3">
        <Input label="Driver offer timeout (s)" type="number" min={10} value={p.driverOfferTimeoutSec} onChange={num('driverOfferTimeoutSec')} />
        <Input label="Booking request timeout (s)" type="number" min={60} value={p.bookingRequestTimeoutSec} onChange={num('bookingRequestTimeoutSec')} />
        <Input label="Shared seat hold (min)" type="number" min={1} value={p.seatHoldMinutes} onChange={num('seatHoldMinutes')} />
      </fieldset>
      {editable && <Button type="submit" loading={save.isPending}>Save operational settings</Button>}
    </form>
  );
}

/** Governance rules: shown read-only, changed only through a proposal the approvers vote on. */
function GovernanceRules({ policy, canPropose }: { policy: Policy; canPropose: boolean }) {
  const { id } = useCommunity();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [rationale, setRationale] = useState('');
  const [draft, setDraft] = useState(policy);
  useEffect(() => setDraft(policy), [policy]);
  const propose = useAction(
    () =>
      api.post(`/communities/${id}/policy-proposals`, {
        title,
        rationale: rationale || undefined,
        changes: {
          fareApprovalMode: draft.fareApprovalMode,
          requiredApprovals: draft.requiredApprovals,
          allowSelfApproval: draft.allowSelfApproval,
          minNoticeHours: draft.minNoticeHours,
          cancellationFreeWindowSec: draft.cancellationFreeWindowSec,
          cancellationFeePaise: draft.cancellationFeePaise,
        },
      }),
    {
      invalidate: [['community', id]],
      success: 'Proposal sent to your approvers. Track it under Fares & governance.',
      onSuccess: () => {
        setOpen(false);
        setTitle('');
        setRationale('');
      },
    },
  );
  return (
    <div className="space-y-4">
      <DefinitionList items={Object.keys(POLICY_LABELS).map((k) => [POLICY_LABELS[k], formatPolicyValue(k, policy[k as keyof Policy])])} />
      <Alert tone="info">
        These rules change only when your approvers vote for a proposal — no single administrator can change them. Set by the platform: max fare increase without review {policy.maxFareIncreasePercent}% · distance fares {policy.allowDistanceFares ? 'allowed' : 'not allowed'} · community fee {policy.communityFeeBps / 100}% of each fare.
      </Alert>
      {canPropose && <Button variant="secondary" onClick={() => setOpen(true)}>Propose a rule change</Button>}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Propose a rule change"
        footer={<Button disabled={title.trim().length < 5} loading={propose.isPending} onClick={() => propose.mutate()}>Send to approvers</Button>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input className="sm:col-span-2" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Longer free cancellation window" />
          <Textarea className="sm:col-span-2" label="Why" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          <Select label="Fare approval" value={draft.fareApprovalMode} onChange={(e) => setDraft({ ...draft, fareApprovalMode: e.target.value })} options={[{ value: 'SINGLE_APPROVER', label: 'One authorised approver' }, { value: 'MULTI_APPROVER', label: 'Several approvers' }, { value: 'PLATFORM_REVIEW', label: 'Approvers + platform review' }]} />
          <Input label="Approvals required" type="number" min={1} max={10} value={draft.requiredApprovals} disabled={draft.fareApprovalMode === 'SINGLE_APPROVER'} onChange={(e) => setDraft({ ...draft, requiredApprovals: Number(e.target.value) })} />
          <Checkbox label="Proposer may approve own proposal" checked={draft.allowSelfApproval} onChange={(e) => setDraft({ ...draft, allowSelfApproval: e.target.checked })} />
          <Input label="Notice before fare changes (hours)" type="number" min={0} value={draft.minNoticeHours} onChange={(e) => setDraft({ ...draft, minNoticeHours: Number(e.target.value) })} />
          <Input label="Free cancellation after acceptance (min)" type="number" min={0} value={Math.round(draft.cancellationFreeWindowSec / 60)} onChange={(e) => setDraft({ ...draft, cancellationFreeWindowSec: Number(e.target.value) * 60 })} />
          <Input label="Cancellation fee (₹)" type="number" min={0} value={draft.cancellationFeePaise / 100} onChange={(e) => setDraft({ ...draft, cancellationFeePaise: rupeesToPaise(Number(e.target.value)) })} />
        </div>
        <p className="mt-3 text-xs text-muted">Only the values you change are proposed. Current: {inr(policy.cancellationFeePaise)} fee, {Math.round(policy.cancellationFreeWindowSec / 60)} min free window.</p>
      </Modal>
    </div>
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
        <Card title="Governance rules">
          <QueryState query={policy}>{(p) => <GovernanceRules policy={p} canPropose={can('fares.propose')} />}</QueryState>
        </Card>
        <Card title="Operational settings" className="lg:col-span-2">
          <QueryState query={policy}>{(p) => <OperationalForm policy={p} editable={can('policy.edit')} />}</QueryState>
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
