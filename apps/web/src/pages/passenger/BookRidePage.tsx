import { useQueries } from '@tanstack/react-query';
import { Crosshair, MapPin, Navigation } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AreaPolygon, BaseMap, BENGALURU, FitBounds, MapClick, Pin, RouteLine } from '@/components/map';
import { PlaceSearch } from '@/components/map/PlaceSearch';
import { Alert, Button, Card, cx, MockLabel, StatusBadge } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useAction, useApi } from '@/hooks/api';
import { useT } from '@/i18n';
import { api, newIdempotencyKey } from '@/services/api';
import type { FareLine, LatLng } from '@/types';
import { inr, km, minutes, time } from '@/utils/format';

type Place = LatLng & { label: string };

interface Quote {
  quoteId: string;
  expiresAt: string;
  communityName: string;
  distanceMeters: number;
  durationSeconds: number;
  distanceSource: 'osrm' | 'estimate';
  geometry: [number, number][] | null;
  fare: { totalPaise: number; lines: FareLine[] };
  dropInsideArea: boolean;
}

interface PublicConfig {
  paymentMethods: string[];
  mockPayments: boolean;
}

async function labelFor(p: LatLng): Promise<string> {
  try {
    const r = await api.get<{ label: string } | null>('/geo/reverse', { lat: p.lat, lng: p.lng });
    return r.data?.label ?? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  } catch {
    return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  }
}

function useServiceAreas() {
  const list = useApi<{ id: string }[]>(['public-communities'], '/communities');
  const details = useQueries({
    queries: (list.data ?? []).map((c) => ({
      queryKey: ['public-community', c.id, undefined],
      queryFn: async () => (await api.get<{ id: string; serviceAreas: { id: string; name: string; polygon: [number, number][] }[] }>(`/communities/${c.id}/public`)).data,
      staleTime: 5 * 60_000,
    })),
  });
  return details.flatMap((d) => d.data?.serviceAreas ?? []);
}

export default function BookRidePage() {
  const { t } = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [pickup, setPickup] = useState<Place | null>(null);
  const [drop, setDrop] = useState<Place | null>(null);
  const [active, setActive] = useState<'pickup' | 'drop'>('pickup');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [payment, setPayment] = useState('CASH');
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const [locating, setLocating] = useState(false);
  const areas = useServiceAreas();
  const config = useApi<PublicConfig>(['config'], '/config');
  const recent = useApi<{ id: string; reference: string; status: string; type: string }[]>(['bookings', 'recent'], '/bookings', { pageSize: 5 });
  const activeBooking = recent.data?.find((b) => ['REQUESTED', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS', 'CONFIRMED'].includes(b.status));

  const setPoint = (field: 'pickup' | 'drop', p: Place) => {
    setQuote(null);
    if (field === 'pickup') {
      setPickup(p);
      if (!drop) setActive('drop');
    } else setDrop(p);
  };

  const onMapClick = async (p: LatLng) => {
    const field = active;
    setPoint(field, { ...p, label: 'Locating address…' });
    setPoint(field, { ...p, label: await labelFor(p) });
  };

  // Location permission is requested only when the passenger taps the button.
  const useMyLocation = () => {
    if (!('geolocation' in navigator)) return toast.error(new Error('Location is not available in this browser. Tap the map instead.'));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocating(false);
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPoint('pickup', { ...p, label: await labelFor(p) });
      },
      (err) => {
        setLocating(false);
        toast.error(new Error(err.code === err.PERMISSION_DENIED ? 'Location permission denied. Search or tap the map to set your pickup.' : 'Could not determine your location. Tap the map instead.'));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const getQuote = useAction(() => api.post<Quote>('/fares/quotes', { pickup: { lat: pickup!.lat, lng: pickup!.lng }, drop: { lat: drop!.lat, lng: drop!.lng } }), {
    onSuccess: (q) => {
      setQuote(q);
      setIdemKey(newIdempotencyKey());
    },
  });

  const book = useAction(
    () => api.post<{ id: string }>('/bookings', { quoteId: quote!.quoteId, idempotencyKey: idemKey, pickupAddress: pickup?.label.slice(0, 300), dropAddress: drop?.label.slice(0, 300), paymentMethod: payment }),
    { invalidate: [['bookings']], onSuccess: (b) => navigate(`/app/bookings/${b.id}`) },
  );

  const points = useMemo(() => [pickup, drop].filter(Boolean) as LatLng[], [pickup, drop]);
  const quoteExpired = quote && new Date(quote.expiresAt) < new Date();

  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{t('book.title')}</h1>
        {activeBooking && (
          <Alert tone="info">
            You have an active booking {activeBooking.reference} <StatusBadge status={activeBooking.status} />.{' '}
            <Link to={`/app/bookings/${activeBooking.id}`} className="font-medium underline">
              View it
            </Link>
          </Alert>
        )}
        <Card>
          <div className="space-y-3">
            <div className={cx('rounded-lg p-2 ring-1', active === 'pickup' ? 'ring-brand-600' : 'ring-transparent')} onFocusCapture={() => setActive('pickup')}>
              <PlaceSearch label={t('book.pickup')} value={pickup?.label ?? ''} near={pickup ?? BENGALURU} onSelect={(p) => setPoint('pickup', p)} />
              <Button variant="ghost" size="sm" className="mt-1" icon={<Crosshair className="size-4" />} onClick={useMyLocation} loading={locating}>
                {t('book.useLocation')}
              </Button>
            </div>
            <div className={cx('rounded-lg p-2 ring-1', active === 'drop' ? 'ring-brand-600' : 'ring-transparent')} onFocusCapture={() => setActive('drop')}>
              <PlaceSearch label={t('book.drop')} value={drop?.label ?? ''} near={pickup ?? BENGALURU} onSelect={(p) => setPoint('drop', p)} />
            </div>
            <div className="flex gap-2" role="radiogroup" aria-label="Which point does a map tap set?">
              {(['pickup', 'drop'] as const).map((f) => (
                <button
                  key={f}
                  role="radio"
                  aria-checked={active === f}
                  onClick={() => setActive(f)}
                  className={cx('flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium ring-1', active === f ? 'bg-brand-50 text-brand-800 ring-brand-600' : 'text-stone-600 ring-stone-300')}
                >
                  <MapPin className="size-3.5" /> {t('book.tapMap', { field: f === 'pickup' ? t('book.pickup') : t('book.drop') })}
                </button>
              ))}
            </div>
            <Button className="w-full" size="lg" disabled={!pickup || !drop} loading={getQuote.isPending} onClick={() => getQuote.mutate()}>
              {t('book.getFare')}
            </Button>
          </div>
        </Card>

        {quote && (
          <Card>
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-stone-600">{t('book.estimate')}</p>
              <p className="text-3xl font-bold tabular-nums">{inr(quote.fare.totalPaise)}</p>
            </div>
            <p className="mt-1 text-sm text-stone-600">
              {km(quote.distanceMeters)} · ~{minutes(quote.durationSeconds)} · {t('book.community', { name: quote.communityName })}
            </p>
            <ul className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-sm">
              {quote.fare.lines.map((l) => (
                <li key={l.code} className="flex justify-between">
                  <span className="text-stone-600">{l.label}</span>
                  <span className="tabular-nums">{inr(l.amountPaise)}</span>
                </li>
              ))}
            </ul>
            {quote.distanceSource === 'estimate' && <p className="mt-2 text-xs text-amber-800">{t('book.estimateNote')}</p>}
            {!quote.dropInsideArea && <p className="mt-2 text-xs text-stone-600">Your destination is outside the community’s pickup area; the auto can still take you there at the published fare.</p>}
            <fieldset className="mt-4">
              <legend className="mb-1 text-sm font-medium">{t('book.payment')}</legend>
              <div className="space-y-1">
                {(config.data?.paymentMethods ?? ['CASH']).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="payment" value={m} checked={payment === m} onChange={() => setPayment(m)} className="text-brand-700 focus:ring-brand-600" />
                    {m === 'CASH' ? t('book.cash') : <>{t('book.mockOnline')} <MockLabel /></>}
                  </label>
                ))}
              </div>
            </fieldset>
            {quoteExpired ? (
              <Alert tone="warn">This quote expired. Get a fresh fare.</Alert>
            ) : (
              <p className="mt-3 text-xs text-stone-500">{t('book.quoteValid', { time: time(quote.expiresAt) })}</p>
            )}
            <Button className="mt-3 w-full" size="lg" variant="accent" icon={<Navigation className="size-4" />} disabled={!!quoteExpired || !!activeBooking} loading={book.isPending} onClick={() => book.mutate()}>
              {t('book.confirm')} · {inr(quote.fare.totalPaise)}
            </Button>
          </Card>
        )}
      </div>

      <BaseMap className="h-[60vh] min-h-80 lg:h-[calc(100dvh-8rem)]" label="Choose pickup and destination">
        <MapClick onClick={onMapClick} />
        {areas.map((a) => (
          <AreaPolygon key={a.id} polygon={a.polygon} name={`${a.name} — community service area`} />
        ))}
        {pickup && <Pin position={pickup} kind="pickup" label={`Pickup: ${pickup.label}`} draggable onDragEnd={async (p) => setPoint('pickup', { ...p, label: await labelFor(p) })} />}
        {drop && <Pin position={drop} kind="drop" label={`Destination: ${drop.label}`} draggable onDragEnd={async (p) => setPoint('drop', { ...p, label: await labelFor(p) })} />}
        {quote?.geometry && <RouteLine points={quote.geometry} />}
        {quote && !quote.geometry && pickup && drop && <RouteLine points={[[pickup.lat, pickup.lng], [drop.lat, drop.lng]]} dashed />}
        <FitBounds points={points} />
      </BaseMap>
    </div>
  );
}
