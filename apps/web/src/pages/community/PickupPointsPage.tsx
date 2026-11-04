import { useState } from 'react';
import { BaseMap, FitBounds, MapClick, Pin } from '@/components/map';
import { Button, Card, Checkbox, ConfirmDialog, DataTable, Input, PageHeader, QueryState, StatusBadge } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';
import type { LatLng, PickupPoint } from '@/types';

export default function PickupPointsPage() {
  const { id, community, can } = useCommunity();
  const editable = can('routes.manage');
  const q = useApi<PickupPoint[]>(['community', id, 'pickup-points'], `/communities/${id}/pickup-points`);
  const [draft, setDraft] = useState<LatLng | null>(null);
  const [name, setName] = useState('');
  const [isStand, setIsStand] = useState(false);
  const inv = [['community', id, 'pickup-points'], ['public-community']];
  const create = useAction(() => api.post(`/communities/${id}/pickup-points`, { name, isStand, ...draft! }), { invalidate: inv, success: 'Pickup point added', onSuccess: () => { setDraft(null); setName(''); setIsStand(false); } });
  const toggle = useAction((p: PickupPoint) => api.patch(`/communities/${id}/pickup-points/${p.id}`, { active: !p.active }), { invalidate: inv, success: 'Updated' });
  const [removing, setRemoving] = useState<PickupPoint | null>(null);
  const remove = useAction(() => api.del(`/communities/${id}/pickup-points/${removing!.id}`), { invalidate: inv, success: 'Pickup point deleted', onSettled: () => setRemoving(null) });
  return (
    <div>
      <PageHeader title="Auto stands & stops" subtitle="Stands are where drivers queue. Stops are used by shared routes." />
      <QueryState query={q}>
        {(points) => (
          <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
            <BaseMap center={{ lat: community.centerLat, lng: community.centerLng }} className="h-[55vh]" label="Pickup points">
              {editable && <MapClick onClick={setDraft} />}
              {points.map((p) => <Pin key={p.id} position={p} kind={p.isStand ? 'stand' : 'stop'} label={`${p.name}${p.active ? '' : ' (inactive)'}`} />)}
              {draft && <Pin position={draft} kind="vertex" label="New point" />}
              <FitBounds points={points} />
            </BaseMap>
            {editable && (
              <Card title="Add a point">
                {!draft ? (
                  <p className="text-sm text-stone-600">Click the map where the stand or stop is.</p>
                ) : (
                  <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
                    <p className="text-xs text-stone-500">{draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}</p>
                    <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
                    <Checkbox label="This is an auto stand (drivers can queue here)" checked={isStand} onChange={(e) => setIsStand(e.target.checked)} />
                    <div className="flex gap-2">
                      <Button type="submit" loading={create.isPending} disabled={name.trim().length < 2}>Add</Button>
                      <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
                    </div>
                  </form>
                )}
              </Card>
            )}
            <Card className="lg:col-span-2">
              <DataTable
                rows={points}
                rowKey={(p) => p.id}
                empty="No pickup points"
                columns={[
                  { header: 'Name', cell: (p) => p.name },
                  { header: 'Type', cell: (p) => (p.isStand ? 'Auto stand' : 'Stop') },
                  { header: 'Location', cell: (p) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` },
                  { header: 'Status', cell: (p) => <StatusBadge status={p.active ? 'ACTIVE' : 'INACTIVE'} /> },
                  { header: '', cell: (p) => editable && <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => toggle.mutate(p)}>{p.active ? 'Disable' : 'Enable'}</Button><Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>Delete</Button></div> },
                ]}
              />
            </Card>
          </div>
        )}
      </QueryState>
      <ConfirmDialog open={!!removing} title={`Delete ${removing?.name}?`} message="A point used by a shared route must be removed from that route first. Points with past trips stay in the trip records." confirmLabel="Delete" tone="danger" loading={remove.isPending} onClose={() => setRemoving(null)} onConfirm={() => remove.mutate()} />
    </div>
  );
}
