import { useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2, Navigation, Power, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BaseMap, FitBounds, MapClick, Pin } from '@/components/map';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Input, MockLabel, PageHeader, QueryState, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useAction, useApi } from '@/hooks/api';
import { useT } from '@/i18n';
import { api } from '@/services/api';
import { useLiveInterval, useSocketEvent } from '@/services/socket';
import type { LatLng, PickupPoint } from '@/types';
import { directionsUrl, inr, km } from '@/utils/format';

interface DriverMe {
  id: string;
  verificationStatus: string;
  status: string;
  availability: { status: 'OFFLINE' | 'ONLINE' | 'ON_TRIP'; communityId: string | null; standId: string | null; stand: { name: string } | null } | null;
  eligibility: { communityId: string; communityName: string; eligible: boolean; reasons: string[]; vehicle: { registrationNumber: string; seatCapacity: number } | null }[];
}
interface Offer {
  id: string;
  expiresAt: string;
  distanceMeters: number | null;
  booking: { id: string; reference: string; pickupLat: number; pickupLng: number; pickupAddress: string | null; dropLat: number; dropLng: number; dropAddress: string | null; distanceMeters: number; quotedFarePaise: number; paymentMethod: string };
}
interface ActiveTrip {
  id: string;
  reference: string;
  status: 'ACCEPTED' | 'ARRIVING' | 'IN_PROGRESS';
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string | null;
  dropLat: number;
  dropLng: number;
  dropAddress: string | null;
  quotedFarePaise: number;
  paymentMethod: string;
  passenger: { firstName: string };
}
interface TripRow {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  finalFarePaise: number | null;
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
  return <span className="tabular-nums">{s}s</span>;
}

type LocationMode = 'device' | 'manual';

/** The driver promise, made concrete: what you kept today and what was deducted. */
function PromiseBanner() {
  const { t } = useT();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const q = useApi<{ days: { date: string; trips: number; farePaise: number; platformFeePaise: number; communityFeePaise: number; driverNetPaise: number }[] }>(['driver', 'earnings', 'today'], '/drivers/me/earnings', undefined, { refetchInterval: 60_000 });
  const d = q.data?.days.find((x) => x.date === today);
  return (
    <section className="flex flex-wrap items-end justify-between gap-4 rounded-[1.75rem] bg-brand-700 p-6 text-paper sm:p-7">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-accent-400">{t('brand.driverPromise')}</p>
        {d ? (
          <>
            <p className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{t('driver.heroKept', { net: inr(d.driverNetPaise) })}</p>
            <p className="text-brand-200">{t('driver.heroTrips', { trips: d.trips, fares: inr(d.farePaise), fees: inr(d.platformFeePaise + d.communityFeePaise) })}</p>
          </>
        ) : (
          <p className="max-w-[48ch] text-lg text-brand-100">{t('driver.heroEmpty')}</p>
        )}
      </div>
      <Link to="/driver/earnings" className="rounded-full bg-accent-400 px-5 py-2.5 font-semibold text-ink hover:bg-accent-500">
        {t('driver.heroLink')} →
      </Link>
    </section>
  );
}

export default function DriverHomePage() {
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useApi<DriverMe>(['driver', 'me'], '/drivers/me', undefined, { refetchInterval: 30_000 });
  const interval = useLiveInterval(5_000);
  const online = me.data?.availability?.status && me.data.availability.status !== 'OFFLINE';
  const offers = useApi<Offer[]>(['driver', 'offers'], '/drivers/me/offers', undefined, { enabled: !!online, refetchInterval: online ? interval : false });
  const active = useApi<ActiveTrip | null>(['driver', 'active'], '/drivers/me/active', undefined, { refetchInterval: interval });
  const recent = useApi<TripRow[]>(['driver', 'trips', 'recent'], '/drivers/me/trips', { pageSize: 10 });
  const refresh = () => ['driver', 'bookings'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  useSocketEvent('offer:new', () => qc.invalidateQueries({ queryKey: ['driver', 'offers'] }));
  useSocketEvent('booking:updated', refresh);

  const approved = me.data?.eligibility ?? [];
  const [communityId, setCommunityId] = useState('');
  const cid = communityId || me.data?.availability?.communityId || approved[0]?.communityId || '';
  const stands = useApi<{ pickupPoints: PickupPoint[] }>(['public-community', cid], cid ? `/communities/${cid}/public` : null);
  const [standId, setStandId] = useState('');
  const [mode, setMode] = useState<LocationMode>('device');
  const [position, setPosition] = useState<LatLng | null>(null);
  const watchRef = useRef<number | null>(null);

  // Share location only while online, and stop as soon as the driver goes offline.
  useEffect(() => {
    if (!online) return;
    if (mode === 'device' && 'geolocation' in navigator) {
      watchRef.current = navigator.geolocation.watchPosition(
        (p) => setPosition({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 15_000 },
      );
      return () => {
        if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      };
    }
  }, [online, mode]);
  useEffect(() => {
    if (!online || !position) return;
    const send = () => api.post('/drivers/me/location', position).catch(() => undefined);
    void send();
    const t = setInterval(send, 30_000);
    return () => clearInterval(t);
  }, [online, position]);

  const goOnline = useAction(
    async () => {
      let pos = position;
      if (mode === 'device') {
        pos = await new Promise<LatLng>((resolve, reject) =>
          navigator.geolocation
            ? navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => reject(new Error('Could not read your location. Allow location access, or set your location on the map.')), { enableHighAccuracy: true, timeout: 10_000 })
            : reject(new Error('This browser has no location access. Set your location on the map.')),
        );
        setPosition(pos);
      }
      if (!pos) throw new Error('Set your location first.');
      return api.post('/drivers/me/availability', { status: 'ONLINE', communityId: cid, standId: standId || null, ...pos });
    },
    { invalidate: [['driver']], success: 'You are online' },
  );
  const goOffline = useAction(() => api.post('/drivers/me/availability', { status: 'OFFLINE' }), { invalidate: [['driver']], success: 'You are offline. Location sharing stopped.' });
  const accept = useAction((id: string) => api.post(`/bookings/${id}/accept`), { invalidate: [['driver']], success: 'Trip accepted — head to the pickup' });
  const reject = useAction((id: string) => api.post(`/bookings/${id}/reject`), { invalidate: [['driver', 'offers']] });
  const arrived = useAction((id: string) => api.post(`/bookings/${id}/arrived`), { invalidate: [['driver']], success: 'Passenger notified that you have arrived' });
  const [pin, setPin] = useState('');
  const start = useAction((id: string) => api.post(`/bookings/${id}/start`, { pin }), { invalidate: [['driver']], success: 'Trip started', onSuccess: () => setPin('') });
  const complete = useAction((id: string) => api.post(`/bookings/${id}/complete`), { invalidate: [['driver']], success: 'Trip completed' });
  const noShow = useAction((id: string) => api.post(`/bookings/${id}/no-show`), { invalidate: [['driver']], success: 'Marked as no-show' });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useAction((id: string) => api.post(`/bookings/${id}/cancel`, { reason }), { invalidate: [['driver']], success: 'Trip cancelled', onSuccess: () => setCancelOpen(false) });
  const cash = useAction((id: string) => api.post(`/payments/bookings/${id}/cash-confirm`), { invalidate: [['driver']], success: 'Cash payment recorded' });
  const sos = useAction((id: string) => api.post<{ ticketReference: string }>(`/bookings/${id}/sos`, { ...(position ?? {}), note: 'SOS from driver app' }), { success: (r) => `Emergency alert ${r.ticketReference} sent. Call 112 if in danger.` });

  if (me.isLoading) return <Spinner />;
  if (me.error) {
    return (
      <div className="space-y-3">
        <PageHeader title="Welcome, driver" />
        <EmptyState title="Complete your driver registration" action={<Link to="/driver/profile" className="font-medium text-brand-700 hover:underline">Add your licence and documents →</Link>}>
          Add your driving licence, upload documents, and apply to your local auto community.
        </EmptyState>
      </div>
    );
  }
  const d = me.data!;
  const eligible = approved.find((e) => e.communityId === cid);
  const awaitingCash = (recent.data ?? []).filter((r) => r.status === 'COMPLETED' && r.paymentMethod === 'CASH' && r.paymentStatus === 'PAYMENT_PENDING');
  const trip = active.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('driver.title')}
        subtitle={<span className="flex items-center gap-2">{t('driver.status')}: <StatusBadge status={d.availability?.status ?? 'OFFLINE'} /> {d.availability?.stand && <Badge tone="blue">Queued at {d.availability.stand.name}</Badge>}</span>}
        actions={online && d.availability?.status === 'ONLINE' && <Button variant="secondary" icon={<Power className="size-4" />} loading={goOffline.isPending} onClick={() => goOffline.mutate()}>{t('driver.goOffline')}</Button>}
      />

      <PromiseBanner />

      {d.verificationStatus !== 'VERIFIED' && <Alert tone="warn">Your verification is {d.verificationStatus.toLowerCase().replace('_', ' ')}. <Link className="underline" to="/driver/profile">Check your documents</Link>.</Alert>}

      {trip && (
        <Card title={<span className="flex items-center gap-2">{t('driver.currentTrip')} {trip.reference} <StatusBadge status={trip.status} /></span>}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 text-sm">
              <p><span className="text-stone-500">Passenger:</span> {trip.passenger.firstName}</p>
              <p><span className="text-stone-500">Pickup:</span> {trip.pickupAddress ?? 'Pinned location'}</p>
              <p><span className="text-stone-500">Drop:</span> {trip.dropAddress ?? 'Pinned location'}</p>
              <p><span className="text-stone-500">Fare:</span> <strong>{inr(trip.quotedFarePaise)}</strong> ({trip.paymentMethod === 'CASH' ? 'collect cash' : 'paid online'}) — {t('driver.fareFixed')}</p>
              <a
                href={directionsUrl(position, trip.status === 'IN_PROGRESS' ? { lat: trip.dropLat, lng: trip.dropLng } : { lat: trip.pickupLat, lng: trip.pickupLng })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-3 py-2 font-medium text-white hover:bg-sky-800"
              >
                <Navigation className="size-4" /> Navigate to {trip.status === 'IN_PROGRESS' ? 'drop' : 'pickup'}
              </a>
              <div className="flex flex-wrap gap-2 pt-2">
                {trip.status === 'ACCEPTED' && <Button loading={arrived.isPending} onClick={() => arrived.mutate(trip.id)}>{t('driver.arrived')}</Button>}
                {trip.status === 'ARRIVING' && (
                  <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); start.mutate(trip.id); }}>
                    <Input label={t('driver.pinLabel')} inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="w-40" />
                    <Button type="submit" disabled={pin.length !== 4} loading={start.isPending}>{t('driver.startTrip')}</Button>
                  </form>
                )}
                {trip.status === 'IN_PROGRESS' && <Button icon={<CheckCircle2 className="size-4" />} loading={complete.isPending} onClick={() => complete.mutate(trip.id)}>{t('driver.completeTrip')}</Button>}
                {trip.status === 'ARRIVING' && <Button variant="secondary" loading={noShow.isPending} onClick={() => noShow.mutate(trip.id)}>{t('driver.noShow')}</Button>}
                {trip.status !== 'IN_PROGRESS' && <Button variant="ghost" icon={<XCircle className="size-4" />} onClick={() => setCancelOpen(true)}>Cancel</Button>}
                <Button variant="danger" icon={<AlertOctagon className="size-4" />} loading={sos.isPending} onClick={() => sos.mutate(trip.id)}>SOS</Button>
              </div>
            </div>
            <BaseMap className="h-64" label="Trip map">
              <Pin position={{ lat: trip.pickupLat, lng: trip.pickupLng }} kind="pickup" label="Pickup" />
              <Pin position={{ lat: trip.dropLat, lng: trip.dropLng }} kind="drop" label="Drop" />
              {position && <Pin position={position} kind="driver" label="You" />}
              <FitBounds points={[{ lat: trip.pickupLat, lng: trip.pickupLng }, { lat: trip.dropLat, lng: trip.dropLng }, ...(position ? [position] : [])]} />
            </BaseMap>
          </div>
          <ConfirmDialog open={cancelOpen} title="Cancel this trip?" message="Cancelling accepted trips affects your community standing. The passenger is notified." confirmLabel="Cancel trip" loading={cancel.isPending} onClose={() => setCancelOpen(false)} onConfirm={() => cancel.mutate(trip.id)}>
            <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </ConfirmDialog>
        </Card>
      )}

      {awaitingCash.length > 0 && (
        <Card title={t('driver.confirmCash')}>
          <ul className="divide-y divide-stone-100">
            {awaitingCash.map((row) => (
              <li key={row.id} className="flex items-center justify-between py-2 text-sm">
                <span>{row.reference} · {inr(row.finalFarePaise)}</span>
                <Button size="sm" loading={cash.isPending} onClick={() => cash.mutate(row.id)}>{t('driver.cashReceived')}</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!online && (
        <Card title={t('driver.goOnline')}>
          {approved.length === 0 ? (
            <EmptyState title="No approved community yet" action={<Link to="/driver/profile" className="font-medium text-brand-700 hover:underline">Apply to a community →</Link>} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <Select label="Operate for" value={cid} onChange={(e) => setCommunityId(e.target.value)} options={approved.map((e) => ({ value: e.communityId, label: e.communityName }))} />
                {eligible && !eligible.eligible && (
                  <Alert tone="warn">
                    You can’t go online yet:
                    <ul className="ml-4 list-disc">{eligible.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  </Alert>
                )}
                {eligible?.vehicle && <p className="text-sm text-stone-600">Vehicle {eligible.vehicle.registrationNumber} · {eligible.vehicle.seatCapacity} seats (set by the community)</p>}
                <Select label="Join a stand queue (optional)" value={standId} onChange={(e) => setStandId(e.target.value)} options={[{ value: '', label: 'No — roam' }, ...(stands.data?.pickupPoints ?? []).filter((p) => p.isStand).map((p) => ({ value: p.id, label: p.name }))]} hint="You must be within 300 m of the stand." />
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">Location</legend>
                  <label className="flex items-center gap-2 text-sm"><input type="radio" checked={mode === 'device'} onChange={() => setMode('device')} /> Use this device’s GPS</label>
                  <label className="flex items-center gap-2 text-sm"><input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} /> Set on the map <MockLabel>Manual location</MockLabel></label>
                </fieldset>
                <p className="text-xs text-stone-500">Your location is shared only while you are online and deleted when you go offline.</p>
                <Button size="lg" className="w-full" icon={<Power className="size-4" />} disabled={!eligible?.eligible || (mode === 'manual' && !position)} loading={goOnline.isPending} onClick={() => goOnline.mutate()}>
                  {t('driver.goOnline')}
                </Button>
              </div>
              {mode === 'manual' && (
                <div>
                  <BaseMap className="h-72" label="Set your location">
                    <MapClick onClick={setPosition} />
                    {position && <Pin position={position} kind="driver" label="Manual location" />}
                    {(stands.data?.pickupPoints ?? []).filter((p) => p.isStand).map((p) => <Pin key={p.id} position={p} kind="stand" label={p.name} />)}
                  </BaseMap>
                  <p className="mt-1 text-xs text-amber-800">Manual location is for when GPS is unavailable or for testing. It is not live tracking.</p>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {online && !trip && (
        <Card title={t('driver.requests')}>
          <QueryState query={offers} empty={(o) => o.length === 0 && <EmptyState title={t('driver.waiting')}>{t('driver.waitingBody')}</EmptyState>}>
            {(list) => (
              <ul className="space-y-3">
                {list.map((o) => (
                  <li key={o.id} className="rounded-xl p-4 ring-1 ring-amber-300">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-2xl font-bold tabular-nums">{inr(o.booking.quotedFarePaise)}</p>
                      <p className="text-sm text-stone-600">Expires in <Countdown until={o.expiresAt} /></p>
                    </div>
                    <p className="text-sm">Pickup {o.distanceMeters !== null ? `${km(o.distanceMeters)} away` : ''}: {o.booking.pickupAddress ?? 'pinned location'}</p>
                    <p className="text-sm">Drop: {o.booking.dropAddress ?? 'pinned location'} · trip {km(o.booking.distanceMeters)} · {o.booking.paymentMethod === 'CASH' ? 'cash' : 'online'}</p>
                    <div className="mt-3 flex gap-2">
                      <Button loading={accept.isPending} onClick={() => accept.mutate(o.booking.id)}>{t('driver.accept')}</Button>
                      <Button variant="secondary" loading={reject.isPending} onClick={() => reject.mutate(o.booking.id)}>{t('driver.decline')}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
          {mode === 'manual' && position && <p className="mt-3 text-xs text-stone-500">Using a manual location: {position.lat.toFixed(4)}, {position.lng.toFixed(4)}.</p>}
          {!position && <p className="mt-3 text-xs text-stone-500">Waiting for a location fix…</p>}
          <p className="mt-2 text-xs text-stone-500">Sharing location while online. <button className="underline" onClick={() => toast.success('Location is deleted when you go offline.')}>Privacy</button></p>
        </Card>
      )}
    </div>
  );
}
