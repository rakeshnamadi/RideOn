import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AreaPolygon, BaseMap, FitBounds, Pin, RouteLine } from '@/components/map';
import { Card, DataTable, PageHeader, QueryState, Badge } from '@/components/ui';
import { useApi } from '@/hooks/api';
import type { FareRule, PickupPoint, RouteStop } from '@/types';
import { daysLabel, dateTime, inr } from '@/utils/format';
import { FareRuleSummary } from '@/features/fares/FareRuleSummary';

interface CommunityListItem {
  id: string;
  name: string;
  description: string | null;
  city: { name: string };
  _count: { sharedRoutes: number };
}

interface PublicCommunity {
  id: string;
  name: string;
  description: string | null;
  contactPhone: string | null;
  centerLat: number;
  centerLng: number;
  city: { name: string };
  policy: { cancellationFreeWindowSec: number; cancellationFeePaise: number } | null;
  serviceAreas: { id: string; name: string; polygon: [number, number][] }[];
  pickupPoints: PickupPoint[];
  sharedRoutes: { id: string; code: string; name: string; description: string | null; boardingRules: string | null; stops: RouteStop[]; schedules: { id: string; departureTime: string; daysOfWeek: number; seatCapacity: number }[] }[];
  announcements: { id: string; title: string; body: string; createdAt: string }[];
  fares: { regular: FareRule | null; shared: { route: { id: string; code: string; name: string }; rule: FareRule }[]; upcoming: FareRule[] };
}

/** Public, no-login view of every participating community's published fares, stands and routes. */
export default function FaresPage() {
  const list = useApi<CommunityListItem[]>(['public-communities'], '/communities');
  const [selected, setSelected] = useState<string | null>(null);
  const id = selected ?? list.data?.[0]?.id ?? null;
  const detail = useApi<PublicCommunity>(['public-community', id], id ? `/communities/${id}/public` : null);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader title="Published fares" subtitle="Fares set by each community through its approval process. No account needed." />
      <QueryState query={list} empty={(d) => d.length === 0 && <p>No communities are live yet.</p>}>
        {(communities) => (
          <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
            <ul className="space-y-2" aria-label="Communities">
              {communities.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelected(c.id)}
                    aria-current={c.id === id}
                    className={`w-full rounded-xl p-3 text-left ring-1 ${c.id === id ? 'bg-brand-50 ring-brand-600' : 'bg-white ring-stone-200 hover:bg-stone-50'}`}
                  >
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-stone-500">
                      {c.city.name} · {c._count.sharedRoutes} shared route{c._count.sharedRoutes === 1 ? '' : 's'}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            <QueryState query={detail}>
              {(c) => (
                <div className="space-y-5">
                  <Card title={c.name}>
                    {c.description && <p className="mb-3 text-sm text-stone-600">{c.description}</p>}
                    <BaseMap center={{ lat: c.centerLat, lng: c.centerLng }} className="h-72" label={`${c.name} service area`}>
                      {c.serviceAreas.map((a) => (
                        <AreaPolygon key={a.id} polygon={a.polygon} name={a.name} />
                      ))}
                      {c.pickupPoints.map((p) => (
                        <Pin key={p.id} position={p} kind={p.isStand ? 'stand' : 'stop'} label={`${p.name}${p.isStand ? ' (auto stand)' : ''}`} />
                      ))}
                      <FitBounds points={c.serviceAreas.flatMap((a) => a.polygon.map(([lat, lng]) => ({ lat, lng })))} />
                    </BaseMap>
                    <p className="mt-2 text-xs text-stone-500">Shaded area: where this community picks up passengers. Blue pins are auto stands.</p>
                  </Card>

                  <Card title="Regular auto fare">
                    {c.fares.regular ? <FareRuleSummary rule={c.fares.regular} /> : <p className="text-sm text-stone-600">Not yet published.</p>}
                    {c.policy && (
                      <p className="mt-3 text-sm text-stone-600">
                        Cancellation: free before a driver accepts and for {Math.round(c.policy.cancellationFreeWindowSec / 60)} min after; then {inr(c.policy.cancellationFeePaise)}.
                      </p>
                    )}
                    {c.fares.upcoming.length > 0 && (
                      <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                        Approved fare change{c.fares.upcoming.length > 1 ? 's' : ''} coming into effect: {c.fares.upcoming.map((r) => dateTime(r.effectiveFrom)).join(', ')}
                      </div>
                    )}
                  </Card>

                  {c.sharedRoutes.map((r) => {
                    const fare = c.fares.shared.find((s) => s.route.id === r.id)?.rule;
                    return (
                      <Card key={r.id} title={<span className="flex items-center gap-2"><Badge tone="blue">{r.code}</Badge> {r.name}</span>} actions={<Link to="/app/shared" className="text-sm font-medium text-brand-700 hover:underline">Book a seat →</Link>}>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-3 text-sm">
                            {fare && <p>Seat fare: <strong>{inr(fare.perSeatPaise)}</strong> for one stop, +{inr(fare.perStopPaise)} per extra stop.</p>}
                            <DataTable
                              rows={r.stops}
                              rowKey={(s) => s.id}
                              columns={[
                                { header: '#', cell: (s) => s.sequence },
                                { header: 'Stop', cell: (s) => s.pickupPoint.name },
                                { header: 'Time', cell: (s) => `+${s.offsetMinutes} min` },
                              ]}
                            />
                            <p className="text-stone-600">
                              Departures: {r.schedules.map((s) => s.departureTime).sort().join(', ') || 'none'} ({r.schedules[0] ? daysLabel(r.schedules[0].daysOfWeek) : ''})
                            </p>
                            {r.boardingRules && <p className="text-stone-600">{r.boardingRules}</p>}
                          </div>
                          <BaseMap className="h-56" label={`Route ${r.code}`}>
                            <RouteLine points={r.stops.map((s) => [s.pickupPoint.lat, s.pickupPoint.lng])} color="#0369a1" dashed />
                            {r.stops.map((s) => (
                              <Pin key={s.id} position={s.pickupPoint} kind="stop" text={String(s.sequence)} label={s.pickupPoint.name} />
                            ))}
                            <FitBounds points={r.stops.map((s) => s.pickupPoint)} />
                          </BaseMap>
                        </div>
                      </Card>
                    );
                  })}

                  {c.announcements.length > 0 && (
                    <Card title="Community announcements">
                      <ul className="space-y-3">
                        {c.announcements.map((a) => (
                          <li key={a.id}>
                            <p className="font-medium">{a.title}</p>
                            <p className="text-sm text-stone-600">{a.body}</p>
                            <p className="text-xs text-stone-400">{dateTime(a.createdAt)}</p>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}
                </div>
              )}
            </QueryState>
          </div>
        )}
      </QueryState>
    </div>
  );
}
