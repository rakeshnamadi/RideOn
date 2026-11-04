import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Polygon, Polyline } from 'react-leaflet';
import { AreaPolygon, BaseMap, FitBounds, MapClick, Pin } from '@/components/map';
import { Alert, Button, Card, ConfirmDialog, Input, PageHeader, QueryState, StatusBadge } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';

interface Area {
  id: string;
  name: string;
  polygon: [number, number][];
  active: boolean;
}

/** Draw service areas by clicking vertices on the map. */
export default function ServiceAreasPage() {
  const { id, community, can } = useCommunity();
  const editable = can('areas.manage');
  const q = useApi<Area[]>(['community', id, 'areas'], `/communities/${id}/service-areas`);
  const [vertices, setVertices] = useState<[number, number][]>([]);
  const [name, setName] = useState('');
  const [toDelete, setToDelete] = useState<Area | null>(null);
  const inv = [['community', id, 'areas'], ['public-community']];
  const create = useAction(() => api.post(`/communities/${id}/service-areas`, { name, polygon: vertices }), { invalidate: inv, success: 'Service area saved', onSuccess: () => { setVertices([]); setName(''); } });
  const toggle = useAction((a: Area) => api.patch(`/communities/${id}/service-areas/${a.id}`, { active: !a.active }), { invalidate: inv, success: 'Updated' });
  const remove = useAction(() => api.del(`/communities/${id}/service-areas/${toDelete!.id}`), { invalidate: inv, success: 'Area deleted', onSuccess: () => setToDelete(null) });

  return (
    <div>
      <PageHeader title="Service areas" subtitle="Passengers can be picked up only inside an active service area." />
      <QueryState query={q}>
        {(areas) => (
          <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
            <div>
              <BaseMap center={{ lat: community.centerLat, lng: community.centerLng }} zoom={14} className="h-[60vh]" label="Service area editor">
                {editable && <MapClick onClick={(p) => setVertices((v) => [...v, [p.lat, p.lng]])} />}
                {areas.map((a) => <AreaPolygon key={a.id} polygon={a.polygon} name={a.name} color={a.active ? '#047857' : '#a8a29e'} />)}
                {vertices.length >= 3 && <Polygon positions={vertices} pathOptions={{ color: '#7c3aed', dashArray: '4 6', fillOpacity: 0.1 }} />}
                {vertices.length === 2 && <Polyline positions={vertices} pathOptions={{ color: '#7c3aed' }} />}
                {vertices.map(([lat, lng], i) => <Pin key={i} position={{ lat, lng }} kind="vertex" label={`Point ${i + 1}`} />)}
                <FitBounds points={areas.flatMap((a) => a.polygon.map(([lat, lng]) => ({ lat, lng })))} />
              </BaseMap>
              {editable && <p className="mt-2 text-sm text-stone-600">Click on the map to add corners of a new area ({vertices.length} added).</p>}
            </div>
            <div className="space-y-4">
              {editable && (
                <Card title="New area">
                  <div className="space-y-3">
                    <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ainavilli mandal" />
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" icon={<Undo2 className="size-4" />} disabled={!vertices.length} onClick={() => setVertices((v) => v.slice(0, -1))}>Undo</Button>
                      <Button variant="ghost" size="sm" disabled={!vertices.length} onClick={() => setVertices([])}>Clear</Button>
                    </div>
                    {vertices.length > 0 && vertices.length < 3 && <Alert tone="info">Add at least 3 points.</Alert>}
                    <Button disabled={vertices.length < 3 || name.trim().length < 2} loading={create.isPending} onClick={() => create.mutate()}>Save area</Button>
                  </div>
                </Card>
              )}
              <Card title="Areas">
                <ul className="space-y-2">
                  {areas.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{a.name}</span>
                      <StatusBadge status={a.active ? 'ACTIVE' : 'INACTIVE'} />
                      {editable && (
                        <span className="ml-auto flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => toggle.mutate(a)}>{a.active ? 'Disable' : 'Enable'}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setToDelete(a)}>Delete</Button>
                        </span>
                      )}
                    </li>
                  ))}
                  {areas.length === 0 && <li className="text-sm text-stone-500">No service areas yet.</li>}
                </ul>
              </Card>
            </div>
          </div>
        )}
      </QueryState>
      <ConfirmDialog open={!!toDelete} title={`Delete ${toDelete?.name}?`} message="Passengers will no longer be able to book pickups inside this area." confirmLabel="Delete" loading={remove.isPending} onClose={() => setToDelete(null)} onConfirm={() => remove.mutate()} />
    </div>
  );
}
