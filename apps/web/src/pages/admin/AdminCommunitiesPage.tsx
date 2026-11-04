import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { BaseMap, MapClick, Pin } from '@/components/map';
import { Button, Card, Checkbox, ConfirmDialog, DataTable, Input, Modal, PageHeader, QueryState, Select, StatusBadge, Tabs, Textarea } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { api } from '@/services/api';
import type { LatLng } from '@/types';
import { UNION_ROLE_HELP, UNION_ROLE_LABELS } from '@/features/union/roles';
import { humanize } from '@/utils/format';

interface Community {
  id: string;
  name: string;
  slug: string;
  status: string;
  statusReason: string | null;
  city: { name: string };
  policy: { maxFareIncreasePercent: number; allowDistanceFares: boolean; communityFeeBps: number } | null;
  admins: { id: string; role: string; user: { name: string; phone: string } }[];
  _count: { memberships: number; bookings: number };
}

const CreateSchema = z.object({
  cityId: z.string().min(1, 'Choose a city'),
  name: z.string().trim().min(3),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,100}$/, 'Lowercase letters, digits and dashes'),
  registrationNumber: z.string().trim().optional(),
  description: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
  headPhone: z.string().trim().optional(),
});

function CreateCommunity({ onDone }: { onDone: () => void }) {
  const cities = useApi<{ id: string; name: string; centerLat: number; centerLng: number }[]>(['admin', 'cities'], '/admin/cities');
  const [center, setCenter] = useState<LatLng | null>(null);
  const form = useForm<z.infer<typeof CreateSchema>>({ resolver: zodResolver(CreateSchema) });
  const cityId = form.watch('cityId');
  const city = cities.data?.find((c) => c.id === cityId);
  const create = useAction(
    (v: z.infer<typeof CreateSchema>) =>
      api.post('/admin/communities', { ...v, headPhone: v.headPhone || undefined, registrationNumber: v.registrationNumber || undefined, description: v.description || undefined, contactPhone: v.contactPhone || undefined, centerLat: center!.lat, centerLng: center!.lng }),
    { invalidate: [['admin', 'communities']], success: 'Union created (pending). Add a service area, then activate it.', onSuccess: onDone },
  );
  const e = form.formState.errors;
  return (
    <form className="space-y-3" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
      <Select label="City" {...form.register('cityId')} error={e.cityId?.message} options={[{ value: '', label: 'Choose…' }, ...(cities.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
      <Input label="Name" {...form.register('name')} error={e.name?.message} />
      <Input label="Slug" placeholder="ainavilli-autos" {...form.register('slug')} error={e.slug?.message} />
      <Input label="Registration number (association/society)" {...form.register('registrationNumber')} />
      <Textarea label="Description" {...form.register('description')} />
      <Input label="Public contact phone" {...form.register('contactPhone')} />
      <Input label="Local admin's mobile (registered person, optional)" {...form.register('headPhone')} />
      {city && (
        <div>
          <p className="mb-1 text-sm font-medium">Click the map to set the union's centre</p>
          <BaseMap center={{ lat: city.centerLat, lng: city.centerLng }} zoom={12} className="h-56">
            <MapClick onClick={setCenter} />
            {center && <Pin position={center} kind="stand" label="Centre" />}
          </BaseMap>
        </div>
      )}
      <Button type="submit" disabled={!center} loading={create.isPending}>Create union</Button>
    </form>
  );
}

export default function AdminCommunitiesPage() {
  const [tab, setTab] = useState<'' | 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'>('');
  const q = useApi<Community[]>(['admin', 'communities', tab], '/admin/communities', { status: tab });
  const [creating, setCreating] = useState(false);
  const [statusChange, setStatusChange] = useState<{ c: Community; status: string } | null>(null);
  const [reason, setReason] = useState('');
  const [policyFor, setPolicyFor] = useState<Community | null>(null);
  const [policy, setPolicy] = useState({ maxFareIncreasePercent: 25, allowDistanceFares: true, communityFeePercent: 0 });
  const changeStatus = useAction(() => api.post(`/admin/communities/${statusChange!.c.id}/status`, { status: statusChange!.status, reason: reason || undefined }), {
    invalidate: [['admin']],
    success: 'Community status updated',
    onSuccess: () => { setStatusChange(null); setReason(''); },
  });
  const savePolicy = useAction(() => api.put(`/admin/communities/${policyFor!.id}/platform-policy`, { maxFareIncreasePercent: policy.maxFareIncreasePercent, allowDistanceFares: policy.allowDistanceFares, communityFeeBps: Math.round(policy.communityFeePercent * 100) }), {
    invalidate: [['admin', 'communities']],
    success: 'Platform limits saved',
    onSuccess: () => setPolicyFor(null),
  });
  const [accessFor, setAccessFor] = useState<Community | null>(null);
  const [accessPhone, setAccessPhone] = useState('');
  const [accessRole, setAccessRole] = useState('LOCAL_ADMIN');
  const giveAccess = useAction(() => api.post(`/communities/${accessFor!.id}/admins`, { phone: accessPhone, role: accessRole }), {
    invalidate: [['admin', 'communities']],
    success: 'Access given. They can open this union’s console when they next sign in.',
    onSuccess: () => { setAccessFor(null); setAccessPhone(''); },
  });
  const [removing, setRemoving] = useState<Community | null>(null);
  const remove = useAction(() => api.del(`/admin/communities/${removing!.id}`), { invalidate: [['admin', 'communities']], success: 'Union deleted', onSettled: () => setRemoving(null) });
  return (
    <div>
      <PageHeader title="Auto unions" subtitle="Give each union its own access. Its local admins configure their own console, and see nothing of any other union." actions={<Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New union</Button>} />
      <Tabs value={tab} onChange={setTab} options={[{ value: '', label: 'All' }, { value: 'PENDING', label: 'Pending' }, { value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }, { value: 'DEACTIVATED', label: 'Deactivated' }]} />
      <Card>
        <QueryState query={q}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              columns={[
                { header: 'Union', cell: (r) => <><Link to={`/community/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.name}</Link><p className="text-xs text-stone-500">{r.city.name} · {r.slug}</p></> },
                { header: 'Status', cell: (r) => <><StatusBadge status={r.status} />{r.statusReason && <p className="text-xs text-stone-500">{r.statusReason}</p>}</> },
                { header: 'People with access', cell: (r) => <span className="text-xs">{r.admins.map((a) => `${a.user.name} (${UNION_ROLE_LABELS[a.role] ?? humanize(a.role)})`).join(', ') || '—'}</span> },
                { header: 'Drivers', cell: (r) => r._count.memberships },
                { header: 'Bookings', cell: (r) => r._count.bookings },
                { header: 'Platform limits', cell: (r) => r.policy && <span className="text-xs">+{r.policy.maxFareIncreasePercent}% max · fee {r.policy.communityFeeBps / 100}%</span> },
                {
                  header: '',
                  cell: (r) => (
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setAccessFor(r)}>Give access</Button>
                      {r.status !== 'ACTIVE' && <Button size="sm" onClick={() => setStatusChange({ c: r, status: 'ACTIVE' })}>{r.status === 'PENDING' ? 'Approve' : 'Reactivate'}</Button>}
                      {r.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => setStatusChange({ c: r, status: 'SUSPENDED' })}>Suspend</Button>}
                      {r.status !== 'DEACTIVATED' && <Button size="sm" variant="ghost" onClick={() => setStatusChange({ c: r, status: 'DEACTIVATED' })}>Deactivate</Button>}
                      <Button size="sm" variant="ghost" onClick={() => { setPolicyFor(r); setPolicy({ maxFareIncreasePercent: r.policy?.maxFareIncreasePercent ?? 25, allowDistanceFares: r.policy?.allowDistanceFares ?? true, communityFeePercent: (r.policy?.communityFeeBps ?? 0) / 100 }); }}>Limits</Button>
                      {r._count.bookings === 0 && <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>Delete</Button>}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </QueryState>
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="New union">{creating && <CreateCommunity onDone={() => setCreating(false)} />}</Modal>
      <Modal open={!!accessFor} onClose={() => setAccessFor(null)} title={`Give access to ${accessFor?.name ?? ''}`} footer={<Button disabled={accessPhone.length < 10} loading={giveAccess.isPending} onClick={() => giveAccess.mutate()}>Give access</Button>}>
        <div className="space-y-3">
          <Input label="Mobile number of a registered person" value={accessPhone} onChange={(e) => setAccessPhone(e.target.value)} />
          <Select label="Role" value={accessRole} onChange={(e) => setAccessRole(e.target.value)} options={Object.entries(UNION_ROLE_LABELS).map(([value, label]) => ({ value, label }))} hint={UNION_ROLE_HELP[accessRole]} />
        </div>
      </Modal>
      <ConfirmDialog open={!!removing} title={`Delete ${removing?.name}?`} message="This removes the union and its setup for good. Unions with bookings, fare history, complaints or statements cannot be deleted: deactivate them instead." confirmLabel="Delete" tone="danger" loading={remove.isPending} onClose={() => setRemoving(null)} onConfirm={() => remove.mutate()} />
      <ConfirmDialog
        open={!!statusChange}
        title={statusChange ? `${humanize(statusChange.status)}: ${statusChange.c.name}` : ''}
        tone={statusChange?.status === 'ACTIVE' ? 'primary' : 'danger'}
        confirmLabel="Confirm"
        loading={changeStatus.isPending}
        onClose={() => setStatusChange(null)}
        onConfirm={() => changeStatus.mutate()}
        message={statusChange?.status === 'ACTIVE' ? 'Passengers will be able to book this community. It must have at least one service area.' : 'Online drivers in this community are taken offline. Trips in progress can finish.'}
      >
        {statusChange?.status !== 'ACTIVE' && <Textarea label="Reason (required, shared with community admins)" value={reason} onChange={(e) => setReason(e.target.value)} />}
      </ConfirmDialog>
      <Modal open={!!policyFor} onClose={() => setPolicyFor(null)} title={`Platform limits — ${policyFor?.name ?? ''}`} footer={<Button loading={savePolicy.isPending} onClick={() => savePolicy.mutate()}>Save</Button>}>
        <div className="space-y-3">
          <Input label="Max fare increase without platform review (%)" type="number" value={policy.maxFareIncreasePercent} onChange={(e) => setPolicy({ ...policy, maxFareIncreasePercent: Number(e.target.value) })} />
          <Checkbox label="Distance-based fares permitted" checked={policy.allowDistanceFares} onChange={(e) => setPolicy({ ...policy, allowDistanceFares: e.target.checked })} />
          <Input label="Community fee (% of each fare)" type="number" step="0.5" value={policy.communityFeePercent} onChange={(e) => setPolicy({ ...policy, communityFeePercent: Number(e.target.value) })} />
        </div>
      </Modal>
    </div>
  );
}
