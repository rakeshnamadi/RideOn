import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BaseMap, FitBounds, Pin, SharedRoutePath } from '@/components/map';
import { Alert, Badge, Button, Card, cx, EmptyState, MockLabel, PageHeader, QueryState, Select } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useT } from '@/i18n';
import { api, newIdempotencyKey } from '@/services/api';
import type { Departure, FareRule } from '@/types';
import { date, inr, time } from '@/utils/format';

interface CommunityOption {
  id: string;
  name: string;
  _count: { sharedRoutes: number };
}

export default function SharedPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const communities = useApi<CommunityOption[]>(['public-communities'], '/communities');
  const withRoutes = (communities.data ?? []).filter((c) => c._count.sharedRoutes > 0);
  const [communityId, setCommunityId] = useState<string>('');
  const cid = communityId || withRoutes[0]?.id || '';
  const fares = useApi<{ shared: { route: { id: string }; rule: FareRule }[] }>(['fares', cid], cid ? `/fares/communities/${cid}` : null);
  const departures = useApi<Departure[]>(['departures', cid], cid ? '/shared-trips/search' : null, { communityId: cid }, { refetchInterval: 30_000 });
  const config = useApi<{ paymentMethods: string[] }>(['config'], '/config');

  const routes = useMemo(() => {
    const m = new Map<string, Departure['route']>();
    for (const d of departures.data ?? []) m.set(d.route.id, d.route);
    return [...m.values()];
  }, [departures.data]);
  const [routeId, setRouteId] = useState('');
  const route = routes.find((r) => r.id === routeId) ?? routes[0];
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const from = route?.stops.find((s) => s.id === fromId) ?? route?.stops[0];
  const to = route?.stops.find((s) => s.id === toId) ?? route?.stops[route.stops.length - 1];
  const [selected, setSelected] = useState<string | null>(null);
  const [seats, setSeats] = useState(1);
  const [payment, setPayment] = useState('CASH');
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  const rule = fares.data?.shared.find((s) => s.route.id === route?.id)?.rule;
  const segments = from && to ? to.sequence - from.sequence : 0;
  const perSeat = rule && segments > 0 ? Math.max(rule.perSeatPaise + rule.perStopPaise * (segments - 1), rule.minimumFarePaise) : null;
  const options = (departures.data ?? []).filter((d) => d.route.id === route?.id);

  const hold = useAction(
    () => api.post<{ id: string }>(`/shared-trips/${selected}/reservations`, { pickupStopId: from!.id, dropStopId: to!.id, seats, idempotencyKey: idemKey, paymentMethod: payment }),
    {
      invalidate: [['departures'], ['bookings']],
      onSuccess: (b) => navigate(`/app/bookings/${b.id}`),
      // A new key after a definitive failure; the same key is reused if the user retries a network error.
    },
  );

  return (
    <div>
      <PageHeader title={t('shared.title')} subtitle={t('shared.subtitle')} />
      <QueryState query={communities} empty={() => withRoutes.length === 0 && <EmptyState title="No shared routes are running yet" />}>
        {() => (
          <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
            <div className="space-y-4">
              <Card>
                <div className="space-y-3">
                  {withRoutes.length > 1 && (
                    <Select label="Community" value={cid} onChange={(e) => { setCommunityId(e.target.value); setRouteId(''); setSelected(null); }} options={withRoutes.map((c) => ({ value: c.id, label: c.name }))} />
                  )}
                  {routes.length > 0 && (
                    <Select label="Route" value={route?.id ?? ''} onChange={(e) => { setRouteId(e.target.value); setFromId(''); setToId(''); setSelected(null); }} options={routes.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))} />
                  )}
                  {route && (
                    <>
                      <Select label={t('shared.from')} value={from?.id ?? ''} onChange={(e) => setFromId(e.target.value)} options={route.stops.slice(0, -1).map((s) => ({ value: s.id, label: `${s.sequence}. ${s.pickupPoint.name}` }))} />
                      <Select label={t('shared.to')} value={to?.id ?? ''} onChange={(e) => setToId(e.target.value)} options={route.stops.filter((s) => !from || s.sequence > from.sequence).map((s) => ({ value: s.id, label: `${s.sequence}. ${s.pickupPoint.name}` }))} />
                      <Select label={t('shared.seats')} value={String(seats)} onChange={(e) => setSeats(Number(e.target.value))} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))} />
                      {perSeat !== null && (
                        <p className="text-sm text-stone-700">
                          {inr(perSeat)} per seat · <strong>{inr(perSeat * seats)}</strong> total <span className="text-stone-500">(confirmed by the server when you hold seats)</span>
                        </p>
                      )}
                      {from && to && to.sequence <= from.sequence && <Alert tone="warn">Choose a drop stop after your boarding stop.</Alert>}
                    </>
                  )}
                </div>
              </Card>
              {route && (
                <BaseMap className="h-64" label={`Route ${route.code}`}>
                  <SharedRoutePath path={route.pathGeometry} stops={route.stops.map((s) => s.pickupPoint)} />
                  {route.stops.map((s) => (
                    <Pin key={s.id} position={s.pickupPoint} kind={s.id === from?.id ? 'pickup' : s.id === to?.id ? 'drop' : 'stop'} text={s.id === from?.id ? 'A' : s.id === to?.id ? 'B' : String(s.sequence)} label={s.pickupPoint.name} />
                  ))}
                  <FitBounds points={route.stops.map((s) => s.pickupPoint)} />
                </BaseMap>
              )}
            </div>

            <div className="space-y-4">
              <Card title="Upcoming departures">
                <QueryState query={departures} empty={() => options.length === 0 && <EmptyState title="No bookable departures on this route right now" />}>
                  {() => (
                    <ul className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Departure">
                      {options.map((d) => {
                        const full = d.seatsAvailable < seats;
                        const boardAt = from ? new Date(new Date(d.departureAt).getTime() + from.offsetMinutes * 60_000) : new Date(d.departureAt);
                        return (
                          <li key={d.id}>
                            <button
                              role="radio"
                              aria-checked={selected === d.id}
                              disabled={full}
                              onClick={() => {
                                setSelected(d.id);
                                setIdemKey(newIdempotencyKey());
                              }}
                              className={cx('w-full rounded-lg p-3 text-left ring-1 disabled:cursor-not-allowed disabled:opacity-50', selected === d.id ? 'bg-brand-50 ring-brand-600' : 'bg-white ring-stone-200 hover:bg-stone-50')}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-lg font-semibold">{time(boardAt)}</span>
                                {d.seatsAvailable === 0 ? <Badge tone="red">{t('shared.full')}</Badge> : <Badge tone={d.seatsAvailable === 1 ? 'amber' : 'green'}>{t('shared.seatsLeft', { n: d.seatsAvailable })}</Badge>}
                              </div>
                              <p className="text-xs text-stone-500">
                                {date(d.departureAt)} · departs first stop {time(d.departureAt)} · booking closes {time(d.bookingClosesAt)}
                              </p>
                              {d.vehicle && <p className="text-xs text-stone-500">Auto {d.vehicle.registrationNumber}</p>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </QueryState>
              </Card>
              {selected && route && from && to && to.sequence > from.sequence && (
                <Card>
                  <fieldset>
                    <legend className="mb-1 text-sm font-medium">{t('book.payment')}</legend>
                    {(config.data?.paymentMethods ?? ['CASH']).map((m) => (
                      <label key={m} className="flex items-center gap-2 text-sm">
                        <input type="radio" name="payment" value={m} checked={payment === m} onChange={() => setPayment(m)} />
                        {m === 'CASH' ? t('book.cash') : <>{t('book.mockOnline')} <MockLabel /></>}
                      </label>
                    ))}
                  </fieldset>
                  {route.boardingRules && <p className="mt-3 text-sm text-stone-600">{route.boardingRules}</p>}
                  <Button className="mt-3 w-full" size="lg" variant="accent" loading={hold.isPending} onClick={() => hold.mutate()}>
                    {t('shared.hold')} · {seats} seat{seats > 1 ? 's' : ''}
                  </Button>
                  <p className="mt-2 text-xs text-stone-500">Seats are held for a few minutes while you confirm. Free cancellation until {route.cancellationCutoffMinutes} min before departure.</p>
                </Card>
              )}
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
