import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, PageHeader, QueryState, Select, StatusBadge, Textarea, Modal } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { api } from '@/services/api';
import { useLiveInterval } from '@/services/socket';
import { dateTime, inr, time } from '@/utils/format';

interface Trip {
  id: string;
  departureAt: string;
  status: string;
  capacity: number;
  seatsBooked: number;
  route: { code: string; name: string };
}

interface Manifest {
  id: string;
  status: string;
  departureAt: string;
  capacity: number;
  seatsBooked: number;
  vehicle: { registrationNumber: string; seatCapacity: number } | null;
  route: { code: string; name: string; stops: { id: string; sequence: number; offsetMinutes: number; pickupPoint: { name: string } }[] };
  bookings: {
    id: string;
    reference: string;
    status: string;
    seatCount: number;
    quotedFarePaise: number;
    paymentMethod: string;
    paymentStatus: string;
    pickupStop: { sequence: number; pickupPoint: { name: string } };
    dropStop: { sequence: number; pickupPoint: { name: string } };
    seats: { seatNumber: number; status: string }[];
    passenger: { firstName: string };
  }[];
}

function ManifestView({ tripId }: { tripId: string }) {
  const interval = useLiveInterval(10_000);
  const q = useApi<Manifest>(['manifest', tripId], `/shared-trips/${tripId}/manifest`, undefined, { refetchInterval: interval });
  const inv = [['manifest', tripId], ['driver']];
  const status = useAction((action: string) => api.post(`/shared-trips/${tripId}/status`, { action }), { invalidate: inv, success: 'Departure updated' });
  const [pins, setPins] = useState<Record<string, string>>({});
  const act = useAction(({ bookingId, action }: { bookingId: string; action: string }) => api.post(`/shared-trips/${tripId}/bookings/${bookingId}/${action}`, { pin: pins[bookingId] }), { invalidate: inv, success: 'Updated' });
  const cash = useAction((id: string) => api.post(`/payments/bookings/${id}/cash-confirm`), { invalidate: inv, success: 'Cash recorded' });
  const [eventOpen, setEventOpen] = useState(false);
  const [eventType, setEventType] = useState('ROUTE_DEVIATION');
  const [note, setNote] = useState('');
  const event = useAction(() => api.post(`/shared-trips/${tripId}/events`, { type: eventType, note }), { success: 'Recorded and shared with the community', onSuccess: () => { setEventOpen(false); setNote(''); } });

  return (
    <QueryState query={q}>
      {(m) => (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={m.status} />
            <span className="text-sm text-stone-600">{m.seatsBooked}/{m.capacity} seats · {m.vehicle?.registrationNumber}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              {m.status === 'SCHEDULED' && <Button size="sm" loading={status.isPending} onClick={() => status.mutate('BOARDING')}>Open boarding</Button>}
              {['SCHEDULED', 'BOARDING'].includes(m.status) && <Button size="sm" variant="secondary" loading={status.isPending} onClick={() => status.mutate('START')}>Depart</Button>}
              {m.status === 'IN_PROGRESS' && <Button size="sm" loading={status.isPending} onClick={() => status.mutate('COMPLETE')}>Complete trip</Button>}
              {['BOARDING', 'IN_PROGRESS'].includes(m.status) && <Button size="sm" variant="ghost" onClick={() => setEventOpen(true)}>Report deviation</Button>}
            </div>
          </div>
          <ol className="space-y-3">
            {m.route.stops.map((s) => {
              const boarding = m.bookings.filter((b) => b.pickupStop.sequence === s.sequence);
              const alighting = m.bookings.filter((b) => b.dropStop.sequence === s.sequence);
              return (
                <li key={s.id} className="rounded-lg p-3 ring-1 ring-stone-200">
                  <p className="font-medium">{s.sequence}. {s.pickupPoint.name} <span className="text-sm font-normal text-stone-500">· {time(new Date(new Date(m.departureAt).getTime() + s.offsetMinutes * 60_000))}</span></p>
                  {boarding.map((b) => (
                    <div key={b.id} className="mt-2 flex flex-wrap items-end gap-2 text-sm">
                      <Badge tone="green">Board</Badge>
                      <span>{b.passenger.firstName} · seat {b.seats.map((x) => x.seatNumber).join(', ')} · {inr(b.quotedFarePaise)} {b.paymentMethod === 'CASH' ? 'cash' : `online (${b.paymentStatus.toLowerCase()})`}</span>
                      <StatusBadge status={b.status} />
                      {b.status === 'CONFIRMED' && m.status !== 'SCHEDULED' && (
                        <>
                          <Input label="PIN" className="w-24" inputMode="numeric" maxLength={4} value={pins[b.id] ?? ''} onChange={(e) => setPins((p) => ({ ...p, [b.id]: e.target.value.replace(/\D/g, '') }))} />
                          <Button size="sm" disabled={(pins[b.id] ?? '').length !== 4} onClick={() => act.mutate({ bookingId: b.id, action: 'board' })}>Board</Button>
                          <Button size="sm" variant="ghost" onClick={() => act.mutate({ bookingId: b.id, action: 'no-show' })}>No-show</Button>
                        </>
                      )}
                    </div>
                  ))}
                  {alighting.map((b) => (
                    <div key={b.id} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone="red">Drop</Badge>
                      <span>{b.passenger.firstName} · {b.seatCount} seat{b.seatCount > 1 ? 's' : ''}</span>
                      {b.status === 'IN_PROGRESS' && <Button size="sm" onClick={() => act.mutate({ bookingId: b.id, action: 'drop' })}>Dropped</Button>}
                      {b.status === 'COMPLETED' && b.paymentMethod === 'CASH' && b.paymentStatus !== 'PAID' && <Button size="sm" variant="secondary" onClick={() => cash.mutate(b.id)}>Cash received</Button>}
                    </div>
                  ))}
                </li>
              );
            })}
          </ol>
          <Modal open={eventOpen} onClose={() => setEventOpen(false)} title="Report a route change" footer={<Button disabled={note.trim().length < 3} loading={event.isPending} onClick={() => event.mutate()}>Record</Button>}>
            <div className="space-y-3">
              <Select label="What happened" value={eventType} onChange={(e) => setEventType(e.target.value)} options={[{ value: 'ROUTE_DEVIATION', label: 'Route deviation' }, { value: 'DELAY', label: 'Delay' }, { value: 'BREAKDOWN', label: 'Breakdown' }]} />
              <Textarea label="Details" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </Modal>
        </div>
      )}
    </QueryState>
  );
}

export default function DriverSharedPage() {
  const mine = useApi<Trip[]>(['driver', 'shared', 'mine'], '/shared-trips/driver/mine', undefined, { refetchInterval: 30_000 });
  const available = useApi<Trip[]>(['driver', 'shared', 'available'], '/shared-trips/driver/available');
  const claim = useAction((id: string) => api.post(`/shared-trips/${id}/claim`), { invalidate: [['driver', 'shared']], success: 'Departure assigned to you' });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader title="Shared departures" subtitle="Scheduled shared-auto runs. Seat counts and fares are set by your community." />
      <Card title="My departures">
        <QueryState query={mine} empty={(d) => d.length === 0 && <EmptyState title="No departures assigned" />}>
          {(trips) => (
            <ul className="space-y-3">
              {trips.map((t) => (
                <li key={t.id} className="rounded-lg ring-1 ring-stone-200">
                  <button className="flex w-full flex-wrap items-center gap-2 p-3 text-left" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
                    <Badge tone="blue">{t.route.code}</Badge>
                    <span className="font-medium">{dateTime(t.departureAt)}</span>
                    <span className="text-sm text-stone-500">{t.route.name}</span>
                    <span className="ml-auto text-sm">{t.seatsBooked}/{t.capacity} booked</span>
                    <StatusBadge status={t.status} />
                  </button>
                  {open === t.id && <div className="border-t border-stone-200 p-3"><ManifestView tripId={t.id} /></div>}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
      <Card title="Open departures you can take">
        <QueryState query={available} empty={(d) => d.length === 0 && <EmptyState title="Nothing open right now" />}>
          {(trips) => (
            <ul className="divide-y divide-stone-100">
              {trips.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Badge tone="blue">{t.route.code}</Badge>
                  <span>{dateTime(t.departureAt)}</span>
                  <span className="text-stone-500">{t.seatsBooked}/{t.capacity} booked</span>
                  <Button size="sm" className="ml-auto" variant="secondary" loading={claim.isPending} onClick={() => claim.mutate(t.id)}>Take this run</Button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
