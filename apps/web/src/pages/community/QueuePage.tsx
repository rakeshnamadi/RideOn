import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BaseMap, FitBounds, Pin } from '@/components/map';
import { Button, Card, ConfirmDialog, EmptyState, Input, PageHeader, QueryState, StatusBadge } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';
import { useLiveInterval, useSocketEvent } from '@/services/socket';
import { relative } from '@/utils/format';

interface QueueData {
  stands: { id: string; name: string; lat: number; lng: number }[];
  drivers: {
    status: string;
    standId: string | null;
    queuedAt: string | null;
    updatedAt: string;
    driver: { id: string; user: { name: string }; location: { lat: number; lng: number; updatedAt: string } | null; vehicleAssignments: { vehicle: { registrationNumber: string } }[] };
  }[];
}

export default function QueuePage() {
  const { id, community } = useCommunity();
  const qc = useQueryClient();
  const interval = useLiveInterval(10_000);
  const q = useApi<QueueData>(['community', id, 'queue'], `/communities/${id}/queue`, undefined, { refetchInterval: interval });
  useSocketEvent('queue:updated', () => qc.invalidateQueries({ queryKey: ['community', id, 'queue'] }));
  const [remove, setRemove] = useState<{ driverId: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const doRemove = useAction(() => api.post(`/communities/${id}/queue/${remove!.driverId}/remove`, { reason }), { invalidate: [['community', id, 'queue']], success: 'Removed from queue', onSuccess: () => { setRemove(null); setReason(''); } });
  return (
    <div>
      <PageHeader title="Live queue" subtitle="Drivers currently online for this community. Locations are shown only while drivers are online." />
      <QueryState query={q}>
        {(d) => (
          <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
            <BaseMap center={{ lat: community.centerLat, lng: community.centerLng }} className="h-[60vh]" label="Online drivers">
              {d.stands.map((s) => <Pin key={s.id} position={s} kind="stand" label={s.name} />)}
              {d.drivers.filter((x) => x.driver.location).map((x) => <Pin key={x.driver.id} position={x.driver.location!} kind="driver" label={`${x.driver.user.name} (${x.status.toLowerCase()})`} />)}
              <FitBounds points={[...d.stands, ...d.drivers.flatMap((x) => (x.driver.location ? [x.driver.location] : []))]} />
            </BaseMap>
            <div className="space-y-4">
              {d.stands.map((s) => {
                const queue = d.drivers.filter((x) => x.standId === s.id).sort((a, b) => (a.queuedAt ?? '').localeCompare(b.queuedAt ?? ''));
                return (
                  <Card key={s.id} title={`${s.name} (${queue.length})`}>
                    {queue.length === 0 ? (
                      <p className="text-sm text-stone-500">No autos waiting.</p>
                    ) : (
                      <ol className="space-y-1 text-sm">
                        {queue.map((x, i) => (
                          <li key={x.driver.id} className="flex items-center gap-2">
                            <span className="w-5 text-stone-500">{i + 1}.</span>
                            <span className="flex-1">{x.driver.user.name} <span className="text-xs text-stone-500">since {x.queuedAt ? relative(x.queuedAt) : '—'}</span></span>
                            <Button size="sm" variant="ghost" onClick={() => setRemove({ driverId: x.driver.id, name: x.driver.user.name })}>Remove</Button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </Card>
                );
              })}
              <Card title={`Online (${d.drivers.length})`}>
                {d.drivers.length === 0 ? (
                  <EmptyState title="No drivers online" />
                ) : (
                  <ul className="space-y-1 text-sm">
                    {d.drivers.map((x) => (
                      <li key={x.driver.id} className="flex items-center gap-2">
                        <span className="flex-1">{x.driver.user.name} · {x.driver.vehicleAssignments[0]?.vehicle.registrationNumber}</span>
                        <StatusBadge status={x.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )}
      </QueryState>
      <ConfirmDialog open={!!remove} title={`Remove ${remove?.name} from the stand queue?`} message="The driver stays online but loses their queue position." confirmLabel="Remove" loading={doRemove.isPending} onClose={() => setRemove(null)} onConfirm={() => doRemove.mutate()}>
        <Input label="Reason (recorded)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
