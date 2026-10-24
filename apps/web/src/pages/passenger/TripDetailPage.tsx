import { useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, CreditCard, Share2, Star, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BaseMap, FitBounds, Pin, RouteLine } from '@/components/map';
import { Alert, Button, Card, ConfirmDialog, DefinitionList, MockLabel, Modal, QueryState, Select, StatusBadge, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useAction, useApi } from '@/hooks/api';
import { useT, type MessageKey } from '@/i18n';
import { api } from '@/services/api';
import { useLiveInterval, useSocketEvent } from '@/services/socket';
import type { BookingStatus, FareLine, LatLng } from '@/types';
import { dateTime, humanize, inr, km, relative, time } from '@/utils/format';

interface BookingDetail {
  id: string;
  reference: string;
  type: 'REGULAR' | 'SHARED';
  status: BookingStatus;
  viewerRole: string;
  paymentStatus: string;
  paymentMethod: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string | null;
  dropLat: number;
  dropLng: number;
  dropAddress: string | null;
  distanceMeters: number;
  quotedFarePaise: number;
  finalFarePaise: number | null;
  waitingChargePaise: number;
  cancellationFeePaise: number;
  seatCount: number;
  startPin?: string;
  requestExpiresAt: string | null;
  createdAt: string;
  cancelReason: string | null;
  community: { id: string; name: string; contactPhone: string | null };
  driver: { firstName: string; rating: number | null; ratingCount: number } | null;
  vehicle: { registrationNumber: string; make: string; model: string; color: string | null } | null;
  statusHistory: { toStatus: string; actorType: string; reason: string | null; createdAt: string }[];
  seats: { seatNumber: number; status: string }[];
  tripInstance: { id: string; departureAt: string; status: string; route: { code: string; name: string; cancellationCutoffMinutes: number } } | null;
  pickupStop: { sequence: number; pickupPoint: { name: string } } | null;
  dropStop: { sequence: number; pickupPoint: { name: string } } | null;
  payments: { id: string; amountPaise: number; method: string; provider: string; status: string; createdAt: string; refunds: { amountPaise: number; status: string; reason: string }[] }[];
  rating: { raterId: string; score: number }[];
  fareBreakdown: FareLine[] | null;
  distanceSource: string | null;
  fareRule: { version: number };
}

const ACTIVE: BookingStatus[] = ['REQUESTED', 'CONFIRMED', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS'];

export default function TripDetailPage() {
  const { id } = useParams();
  const { t } = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const interval = useLiveInterval(5_000);
  const q = useApi<BookingDetail>(['booking', id], `/bookings/${id}`, undefined, { refetchInterval: interval });
  const b = q.data;
  const live = !!b && ['ACCEPTED', 'ARRIVING', 'IN_PROGRESS'].includes(b.status);
  const loc = useApi<(LatLng & { updatedAt: string }) | null>(['booking', id, 'driver-location'], `/bookings/${id}/driver-location`, undefined, { enabled: live, refetchInterval: live ? interval : false });
  const [liveLoc, setLiveLoc] = useState<(LatLng & { at: string }) | null>(null);

  useSocketEvent<{ bookingId: string }>('booking:updated', (p) => p.bookingId === id && qc.invalidateQueries({ queryKey: ['booking', id] }));
  useSocketEvent<{ bookingId: string; lat: number; lng: number; at: string }>('driver:location', (p) => p.bookingId === id && setLiveLoc(p));

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [sosOpen, setSosOpen] = useState(false);
  const [complainOpen, setComplainOpen] = useState(false);
  const [category, setCategory] = useState('DRIVER_BEHAVIOUR');
  const [complaint, setComplaint] = useState('');
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [share, setShare] = useState<string | null>(null);

  const invalidate = [['booking', id], ['bookings']];
  const cancel = useAction(() => api.post<{ cancellationFeePaise: number; feeReason: string }>(`/bookings/${id}/cancel`, { reason: cancelReason || 'Cancelled by passenger' }), {
    invalidate,
    success: (r) => (r.cancellationFeePaise ? `Booking cancelled. Cancellation fee ${inr(r.cancellationFeePaise)} (${r.feeReason}).` : 'Booking cancelled at no charge.'),
    onSuccess: () => setCancelOpen(false),
  });
  const confirm = useAction(() => api.post(`/bookings/${id}/confirm`), { invalidate, success: 'Seats confirmed' });
  const pay = useAction(() => api.post<{ checkoutUrl: string }>(`/payments/bookings/${id}/checkout`), {
    invalidate,
    onSuccess: (r) => {
      window.open(r.checkoutUrl, '_blank', 'noopener');
      toast.success('Checkout opened in a new tab. Payment status updates here once the provider confirms it.');
    },
  });
  const rate = useAction(() => api.post('/ratings', { bookingId: id, score, comment: comment || undefined }), { invalidate, success: 'Thanks for rating your driver' });
  const report = useAction(() => api.post('/complaints', { bookingId: id, category, description: complaint }), {
    success: (r: unknown) => `Complaint ${(r as { reference: string }).reference} submitted to the community`,
    onSuccess: () => {
      setComplainOpen(false);
      setComplaint('');
    },
  });
  const shareTrip = useAction(() => api.post<{ path: string }>(`/bookings/${id}/share`), { onSuccess: (r) => setShare(`${window.location.origin}${r.path}`) });
  const sos = useAction(
    () =>
      new Promise<{ lat?: number; lng?: number }>((resolve) =>
        navigator.geolocation
          ? navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve({}), { timeout: 5000 })
          : resolve({}),
      ).then((pos) => api.post<{ ticketReference: string }>(`/bookings/${id}/sos`, { ...pos, note: 'SOS from passenger app' })),
    { success: (r) => `Emergency alert ${r.ticketReference} sent to the platform and community. Call 112 if you are in danger.`, onSuccess: () => setSosOpen(false) },
  );

  return (
    <QueryState query={q}>
      {(b) => {
        const driverPos = liveLoc ?? loc.data ?? null;
        const active = ACTIVE.includes(b.status);
        const canPay = b.paymentMethod !== 'CASH' && b.paymentStatus !== 'PAID' && b.paymentStatus !== 'REFUNDED' && ((b.type === 'REGULAR' && b.status === 'COMPLETED') || (b.type === 'SHARED' && ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(b.status)));
        const rated = b.rating.length > 0;
        const holdExpired = b.type === 'SHARED' && b.status === 'REQUESTED' && b.requestExpiresAt && new Date(b.requestExpiresAt) < new Date();
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Link to="/app/bookings" className="text-sm text-brand-700 hover:underline">
                  ← {t('nav.trips')}
                </Link>
                <h1 className="text-xl font-semibold">
                  {b.type === 'SHARED' ? `Shared auto ${b.tripInstance?.route.code}` : 'Auto ride'} · {b.reference}
                </h1>
              </div>
              <StatusBadge status={b.status} label={t(`status.${b.status}` as MessageKey)} />
            </div>

            {b.status === 'REQUESTED' && b.type === 'REGULAR' && <Alert tone="info">Looking for a nearby community driver. Requests expire automatically if nobody accepts{b.requestExpiresAt ? ` (by ${time(b.requestExpiresAt)})` : ''}.</Alert>}
            {b.status === 'NO_DRIVER_AVAILABLE' && <Alert tone="warn">No driver was available right now. <Link to="/app" className="font-medium underline">Try again</Link> or book a shared auto.</Alert>}
            {b.type === 'SHARED' && b.status === 'REQUESTED' && !holdExpired && (
              <Alert tone="warn">
                {t('shared.holdExpires', { time: time(b.requestExpiresAt) })}{' '}
                <Button size="sm" className="ml-2" loading={confirm.isPending} onClick={() => confirm.mutate()}>
                  {t('shared.confirm')}
                </Button>
              </Alert>
            )}

            <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
              <div className="space-y-4">
                <BaseMap className="h-80" label="Trip map">
                  <Pin position={{ lat: b.pickupLat, lng: b.pickupLng }} kind="pickup" label={b.pickupAddress ?? 'Pickup'} />
                  <Pin position={{ lat: b.dropLat, lng: b.dropLng }} kind="drop" label={b.dropAddress ?? 'Destination'} />
                  {driverPos && <Pin position={driverPos} kind="driver" label="Your auto" />}
                  <RouteLine points={[[b.pickupLat, b.pickupLng], [b.dropLat, b.dropLng]]} dashed color="#78716c" />
                  <FitBounds points={[{ lat: b.pickupLat, lng: b.pickupLng }, { lat: b.dropLat, lng: b.dropLng }, ...(driverPos ? [driverPos] : [])]} />
                </BaseMap>
                {live && <p className="text-xs text-stone-500">{driverPos ? `Driver location updated ${relative('at' in driverPos ? driverPos.at : driverPos.updatedAt)}.` : 'Driver location will appear when the driver shares it.'}</p>}

                <Card title="Trip">
                  <DefinitionList
                    items={[
                      [b.type === 'SHARED' ? 'Board at' : 'Pickup', b.pickupStop?.pickupPoint.name ?? b.pickupAddress ?? '—'],
                      [b.type === 'SHARED' ? 'Get off at' : 'Destination', b.dropStop?.pickupPoint.name ?? b.dropAddress ?? '—'],
                      ...(b.tripInstance ? ([['Departure', dateTime(b.tripInstance.departureAt)], ['Seats', `${b.seatCount} (seat ${b.seats.map((s) => s.seatNumber).join(', ') || '—'})`]] as [string, string][]) : ([['Distance', km(b.distanceMeters)]] as [string, string][])),
                      ['Community', b.community.name],
                      ['Booked', dateTime(b.createdAt)],
                      ...(b.cancelReason ? ([['Cancellation reason', b.cancelReason]] as [string, string][]) : []),
                    ]}
                  />
                </Card>

                <Card title="Status history">
                  <ol className="space-y-2 text-sm">
                    {b.statusHistory.map((h, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="w-20 shrink-0 text-stone-500">{time(h.createdAt)}</span>
                        <span>
                          {t(`status.${h.toStatus}` as MessageKey)} <span className="text-stone-500">· {humanize(h.actorType)}</span>
                          {h.reason && <span className="block text-xs text-stone-500">{h.reason}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Card>
              </div>

              <div className="space-y-4">
                {b.startPin && active && (
                  <Card>
                    <p className="text-sm text-stone-600">{t('trip.pin')}</p>
                    <p className="mt-1 font-mono text-4xl font-bold tracking-[0.3em]" aria-label={`PIN ${b.startPin.split('').join(' ')}`}>
                      {b.startPin}
                    </p>
                    <p className="mt-2 text-xs text-stone-500">{t('trip.pinHelp')}</p>
                  </Card>
                )}
                {b.driver && b.vehicle && (
                  <Card title="Your driver">
                    <DefinitionList
                      items={[
                        ['Driver', b.driver.firstName],
                        ['Rating', b.driver.rating ? `${b.driver.rating} ★ (${b.driver.ratingCount})` : 'New driver'],
                        ['Vehicle', `${b.vehicle.registrationNumber}`],
                        ['Model', `${b.vehicle.make} ${b.vehicle.model}${b.vehicle.color ? ` · ${b.vehicle.color}` : ''}`],
                      ]}
                    />
                    <p className="mt-2 text-xs text-stone-500">Check the registration number before you board. Phone numbers are never shared.</p>
                  </Card>
                )}

                <Card title="Fare">
                  <p className="text-2xl font-bold tabular-nums">{inr(b.finalFarePaise ?? b.quotedFarePaise)}</p>
                  {b.fareBreakdown && (
                    <ul className="mt-2 space-y-0.5 text-sm">
                      {b.fareBreakdown.map((l) => (
                        <li key={l.code} className="flex justify-between">
                          <span className="text-stone-600">{l.label}</span>
                          <span className="tabular-nums">{inr(l.amountPaise)}</span>
                        </li>
                      ))}
                      {b.waitingChargePaise > 0 && (
                        <li className="flex justify-between">
                          <span className="text-stone-600">Waiting charge</span>
                          <span>{inr(b.waitingChargePaise)}</span>
                        </li>
                      )}
                    </ul>
                  )}
                  {b.cancellationFeePaise > 0 && <p className="mt-2 text-sm text-amber-800">Cancellation fee: {inr(b.cancellationFeePaise)}</p>}
                  <p className="mt-2 text-xs text-stone-500">Fare table v{b.fareRule.version} · locked when you booked.</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    Payment: <StatusBadge status={b.paymentStatus} /> <span className="text-stone-500">{b.paymentMethod === 'CASH' ? 'Cash' : 'Online'}</span>
                    {b.paymentMethod === 'MOCK_ONLINE' && <MockLabel />}
                  </div>
                  {canPay && (
                    <Button className="mt-3 w-full" icon={<CreditCard className="size-4" />} loading={pay.isPending} onClick={() => pay.mutate()}>
                      {t('trip.pay')}
                    </Button>
                  )}
                  {b.payments.some((p) => p.refunds.length) && (
                    <p className="mt-2 text-sm text-stone-600">
                      Refunds: {b.payments.flatMap((p) => p.refunds).map((r) => `${inr(r.amountPaise)} (${humanize(r.status)})`).join(', ')}
                    </p>
                  )}
                </Card>

                {b.status === 'COMPLETED' && b.driver && !rated && (
                  <Card title={t('trip.rate')}>
                    <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} role="radio" aria-checked={score === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setScore(n)} className="p-1">
                          <Star className={`size-7 ${n <= score ? 'fill-accent-400 text-accent-500' : 'text-stone-300'}`} />
                        </button>
                      ))}
                    </div>
                    <Textarea label="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} className="mt-2" />
                    <Button className="mt-2" disabled={!score} loading={rate.isPending} onClick={() => rate.mutate()}>
                      Submit rating
                    </Button>
                  </Card>
                )}

                <Card>
                  <div className="flex flex-col gap-2">
                    {active && b.status !== 'IN_PROGRESS' && (
                      <Button variant="secondary" icon={<XCircle className="size-4" />} onClick={() => setCancelOpen(true)}>
                        {t('trip.cancel')}
                      </Button>
                    )}
                    {active && b.type === 'REGULAR' && (
                      <Button variant="secondary" icon={<Share2 className="size-4" />} loading={shareTrip.isPending} onClick={() => shareTrip.mutate()}>
                        {t('trip.share')}
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => setComplainOpen(true)}>
                      {t('trip.complain')}
                    </Button>
                    {active && (
                      <Button variant="danger" icon={<AlertOctagon className="size-4" />} onClick={() => setSosOpen(true)}>
                        {t('trip.sos')}
                      </Button>
                    )}
                  </div>
                  {share && (
                    <div className="mt-3 space-y-2 text-sm">
                      <p className="break-all rounded bg-stone-100 p-2 font-mono text-xs">{share}</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(share).then(() => toast.success('Link copied'))}>
                          Copy link
                        </Button>
                        <a className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-stone-300 hover:bg-stone-100" href={`https://wa.me/?text=${encodeURIComponent(`Track my auto ride: ${share}`)}`} target="_blank" rel="noopener noreferrer">
                          Send on WhatsApp
                        </a>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            </div>

            <ConfirmDialog
              open={cancelOpen}
              title={t('trip.cancel')}
              confirmLabel="Cancel booking"
              loading={cancel.isPending}
              onClose={() => setCancelOpen(false)}
              onConfirm={() => cancel.mutate()}
              message={
                b.type === 'SHARED'
                  ? `Free until ${b.tripInstance?.route.cancellationCutoffMinutes ?? 0} minutes before departure; after that the community's cancellation fee may apply. Your seats are released immediately.`
                  : b.status === 'REQUESTED'
                    ? 'No fee — a driver has not accepted yet.'
                    : 'Cancelling after the free window may incur the community’s published cancellation fee.'
              }
            >
              <Textarea label="Reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Plans changed" />
            </ConfirmDialog>

            <ConfirmDialog
              open={sosOpen}
              title="Send an emergency alert?"
              confirmLabel="Send alert"
              loading={sos.isPending}
              onClose={() => setSosOpen(false)}
              onConfirm={() => sos.mutate()}
              message={
                <>
                  <p>This alerts the RideOn safety team and the community with your trip details and location.</p>
                  <p className="font-semibold">
                    If you are in immediate danger, call{' '}
                    <a href="tel:112" className="text-red-700 underline">
                      112
                    </a>{' '}
                    now.
                  </p>
                </>
              }
            />

            <Modal
              open={complainOpen}
              onClose={() => setComplainOpen(false)}
              title={t('trip.complain')}
              footer={
                <Button disabled={complaint.trim().length < 10} loading={report.isPending} onClick={() => report.mutate()}>
                  Submit
                </Button>
              }
            >
              <div className="space-y-3">
                <Select
                  label="What happened?"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  options={['DRIVER_BEHAVIOUR', 'SAFETY', 'FARE', 'VEHICLE', 'ROUTE', 'PAYMENT', 'OTHER'].map((c) => ({ value: c, label: humanize(c) }))}
                />
                <Textarea label="Details" hint="At least 10 characters. The community reviews every complaint." value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={4} />
              </div>
            </Modal>
          </div>
        );
      }}
    </QueryState>
  );
}
