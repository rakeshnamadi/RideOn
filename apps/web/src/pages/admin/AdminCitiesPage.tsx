import { useState } from 'react';
import { BaseMap, MapClick, Pin } from '@/components/map';
import { Button, Card, DataTable, Input, PageHeader, QueryState, StatusBadge } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { api } from '@/services/api';
import type { LatLng } from '@/types';

interface City {
  id: string;
  name: string;
  state: string;
  timezone: string;
  active: boolean;
  centerLat: number;
  centerLng: number;
  _count: { communities: number };
}

export default function AdminCitiesPage() {
  const q = useApi<City[]>(['admin', 'cities'], '/admin/cities');
  const [name, setName] = useState('');
  const [state, setState] = useState('');
  const [center, setCenter] = useState<LatLng | null>(null);
  const create = useAction(() => api.post('/admin/cities', { name, state, centerLat: center!.lat, centerLng: center!.lng }), { invalidate: [['admin', 'cities']], success: 'City added', onSuccess: () => { setName(''); setState(''); setCenter(null); } });
  const toggle = useAction((c: City) => api.patch(`/admin/cities/${c.id}`, { active: !c.active }), { invalidate: [['admin', 'cities']], success: 'City updated' });
  const remove = useAction((c: City) => api.del(`/admin/cities/${c.id}`), { invalidate: [['admin', 'cities']], success: 'City deleted' });
  return (
    <div className="space-y-5">
      <PageHeader title="Cities" subtitle="Supported cities and districts. Unions operate within one." />
      <Card>
        <QueryState query={q}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              columns={[
                { header: 'City', cell: (r) => `${r.name}, ${r.state}` },
                { header: 'Timezone', cell: (r) => r.timezone },
                { header: 'Unions', cell: (r) => r._count.communities },
                { header: 'Status', cell: (r) => <StatusBadge status={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
                { header: '', cell: (r) => <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => toggle.mutate(r)}>{r.active ? 'Disable' : 'Enable'}</Button>{r._count.communities === 0 && <Button size="sm" variant="ghost" onClick={() => remove.mutate(r)}>Delete</Button>}</div> },
              ]}
            />
          )}
        </QueryState>
      </Card>
      <Card title="Add a city">
        <div className="grid gap-4 md:grid-cols-2">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Input label="City" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="State" value={state} onChange={(e) => setState(e.target.value)} />
            <p className="text-sm text-stone-600">{center ? `Centre: ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}` : 'Click the map to set the city centre.'}</p>
            <Button type="submit" disabled={!center || name.length < 2 || state.length < 2} loading={create.isPending}>Add city</Button>
          </form>
          <BaseMap center={{ lat: 20.6, lng: 78.9 }} zoom={4} className="h-64" label="City centre">
            <MapClick onClick={setCenter} />
            {center && <Pin position={center} kind="stand" label="City centre" />}
          </BaseMap>
        </div>
      </Card>
    </div>
  );
}
