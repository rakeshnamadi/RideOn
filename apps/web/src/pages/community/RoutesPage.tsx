import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { BaseMap, FitBounds, Pin, SharedRoutePath } from '@/components/map';
import { Alert, Badge, Button, Card, DataTable, Input, Modal, PageHeader, QueryState, Select, StatusBadge, Textarea } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';
import type { PickupPoint, RouteStop } from '@/types';
import { daysLabel, km, WEEKDAYS } from '@/utils/format';

interface Route {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  maxSeats: number;
  bookingCutoffMinutes: number;
  cancellationCutoffMinutes: number;
  boardingRules: string | null;
  pathGeometry: [number, number][] | null;
  pathDistanceMeters: number | null;
  stops: RouteStop[];
  schedules: { id: string; departureTime: string; daysOfWeek: number; seatCapacity: number; active: boolean; validFrom: string }[];
}

const RouteSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, '2–20 letters, digits or dashes'),
  name: z.string().trim().min(3, 'At least 3 characters'),
  description: z.string().trim().optional(),
  maxSeats: z.coerce.number().int().min(1).max(6),
  bookingCutoffMinutes: z.coerce.number().int().min(0).max(240),
  cancellationCutoffMinutes: z.coerce.number().int().min(0).max(1440),
  boardingRules: z.string().trim().optional(),
  stops: z.array(z.object({ pickupPointId: z.string().min(1, 'Choose a stop'), offsetMinutes: z.coerce.number().int().min(0) })).min(2, 'At least two stops'),
});
type RouteValues = z.infer<typeof RouteSchema>;

function RouteForm({ points, onDone }: { points: PickupPoint[]; onDone: () => void }) {
  const { id } = useCommunity();
  const form = useForm<RouteValues>({
    resolver: zodResolver(RouteSchema),
    defaultValues: { maxSeats: 3, bookingCutoffMinutes: 5, cancellationCutoffMinutes: 15, stops: [{ pickupPointId: '', offsetMinutes: 0 }, { pickupPointId: '', offsetMinutes: 10 }] },
  });
  const stops = useFieldArray({ control: form.control, name: 'stops' });
  const create = useAction((v: RouteValues) => api.post(`/communities/${id}/routes`, { ...v, description: v.description || null, boardingRules: v.boardingRules || null }), {
    invalidate: [['community', id, 'routes']],
    success: 'Route created as a draft. Propose a fare for it, then activate.',
    onSuccess: onDone,
  });
  const e = form.formState.errors;
  return (
    <form className="space-y-3" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Code" placeholder="KM-2" {...form.register('code')} error={e.code?.message} />
        <Input label="Name" placeholder="Forum → Madiwala" {...form.register('name')} error={e.name?.message} />
        <Input label="Max seats" type="number" {...form.register('maxSeats')} error={e.maxSeats?.message} hint="Cannot exceed approved vehicle capacity" />
        <Input label="Booking closes (min before)" type="number" {...form.register('bookingCutoffMinutes')} error={e.bookingCutoffMinutes?.message} />
        <Input label="Free cancellation until (min before)" type="number" {...form.register('cancellationCutoffMinutes')} error={e.cancellationCutoffMinutes?.message} />
      </div>
      <Textarea label="Description" {...form.register('description')} />
      <Textarea label="Boarding rules" {...form.register('boardingRules')} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Stops in order</legend>
        {stops.fields.map((f, i) => (
          <div key={f.id} className="flex items-end gap-2">
            <span className="mb-2 w-5 text-sm text-stone-500">{i + 1}.</span>
            <Select className="flex-1" label="Stop" {...form.register(`stops.${i}.pickupPointId`)} error={e.stops?.[i]?.pickupPointId?.message} options={[{ value: '', label: 'Choose…' }, ...points.filter((p) => p.active !== false).map((p) => ({ value: p.id, label: p.name }))]} />
            <Input className="w-28" label="+ minutes" type="number" {...form.register(`stops.${i}.offsetMinutes`)} />
            <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} onClick={() => stops.move(i, i - 1)}><ArrowUp className="size-4" /></Button>
            <Button variant="ghost" size="sm" aria-label="Move down" disabled={i === stops.fields.length - 1} onClick={() => stops.move(i, i + 1)}><ArrowDown className="size-4" /></Button>
            <Button variant="ghost" size="sm" aria-label="Remove stop" disabled={stops.fields.length <= 2} onClick={() => stops.remove(i)}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        {e.stops?.message && <p className="text-sm text-red-700">{e.stops.message}</p>}
        <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => stops.append({ pickupPointId: '', offsetMinutes: (form.getValues('stops').at(-1)?.offsetMinutes ?? 0) + 5 })}>Add stop</Button>
        <p className="text-xs text-stone-500">The first stop is at departure (+0). Minutes must increase along the route.</p>
      </fieldset>
      <Button type="submit" loading={create.isPending}>Create route</Button>
    </form>
  );
}

function ScheduleForm({ route, onDone }: { route: Route; onDone: () => void }) {
  const { id } = useCommunity();
  const [time, setTime] = useState('08:00');
  const [days, setDays] = useState(127);
  const [capacity, setCapacity] = useState(route.maxSeats);
  const add = useAction(() => api.post(`/communities/${id}/routes/${route.id}/schedules`, { departureTime: time, daysOfWeek: days, seatCapacity: capacity, validFrom: new Date().toISOString() }), {
    invalidate: [['community', id, 'routes']],
    success: 'Departure time added',
    onSuccess: onDone,
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <Input label="Departure time (from first stop)" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Days</legend>
        <div className="flex flex-wrap gap-1">
          {WEEKDAYS.map((d, i) => (
            <label key={d} className={`cursor-pointer rounded-lg px-2.5 py-1 text-sm ring-1 ${days & (1 << i) ? 'bg-brand-50 ring-brand-600' : 'ring-stone-300'}`}>
              <input type="checkbox" className="sr-only" checked={!!(days & (1 << i))} onChange={() => setDays(days ^ (1 << i))} />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <Input label="Seats sold" type="number" min={1} max={route.maxSeats} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} hint={`Route maximum: ${route.maxSeats}`} />
      <Button type="submit" disabled={days === 0} loading={add.isPending}>Add departure time</Button>
    </form>
  );
}

export default function RoutesPage() {
  const { id, can } = useCommunity();
  const editable = can('routes.manage');
  const q = useApi<Route[]>(['community', id, 'routes'], `/communities/${id}/routes`);
  const points = useApi<PickupPoint[]>(['community', id, 'pickup-points'], `/communities/${id}/pickup-points`);
  const [creating, setCreating] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<Route | null>(null);
  const status = useAction(({ r, status }: { r: Route; status: string }) => api.patch(`/communities/${id}/routes/${r.id}`, { status }), { invalidate: [['community', id, 'routes'], ['departures']], success: 'Route status updated' });
  const toggleSchedule = useAction(({ r, s }: { r: Route; s: Route['schedules'][number] }) => api.patch(`/communities/${id}/routes/${r.id}/schedules/${s.id}`, { active: !s.active }), { invalidate: [['community', id, 'routes']], success: 'Schedule updated' });

  return (
    <div className="space-y-5">
      <PageHeader title="Shared routes" subtitle="Scheduled routes with fixed stops. Routes go live only with an approved fare." actions={editable && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New route</Button>} />
      <QueryState query={q} empty={(d) => d.length === 0 && <Alert tone="info">No shared routes yet.</Alert>}>
        {(routes) => (
          <div className="space-y-4">
            {routes.map((r) => (
              <Card
                key={r.id}
                title={<span className="flex items-center gap-2"><Badge tone="blue">{r.code}</Badge> {r.name} <StatusBadge status={r.status} /></span>}
                actions={
                  editable && (
                    <>
                      {r.status !== 'ACTIVE' && <Button size="sm" onClick={() => status.mutate({ r, status: 'ACTIVE' })}>Activate</Button>}
                      {r.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => status.mutate({ r, status: 'SUSPENDED' })}>Suspend</Button>}
                      <Button size="sm" variant="secondary" onClick={() => setScheduleFor(r)}>Add departure time</Button>
                    </>
                  )
                }
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <p className="text-sm text-stone-600">{r.pathDistanceMeters ? `${km(r.pathDistanceMeters)} by road · ` : 'Road path pending · '}{r.maxSeats} seats max · booking closes {r.bookingCutoffMinutes} min before · free cancel until {r.cancellationCutoffMinutes} min before</p>
                    <ol className="space-y-1 text-sm">{r.stops.map((s) => <li key={s.id}>{s.sequence}. {s.pickupPoint.name} <span className="text-stone-500">+{s.offsetMinutes} min</span></li>)}</ol>
                    <DataTable
                      rows={r.schedules}
                      rowKey={(s) => s.id}
                      empty="No departure times yet"
                      columns={[
                        { header: 'Time', cell: (s) => s.departureTime },
                        { header: 'Days', cell: (s) => daysLabel(s.daysOfWeek) },
                        { header: 'Seats', cell: (s) => s.seatCapacity },
                        { header: 'Status', cell: (s) => <StatusBadge status={s.active ? 'ACTIVE' : 'INACTIVE'} /> },
                        { header: '', cell: (s) => editable && <Button size="sm" variant="ghost" onClick={() => toggleSchedule.mutate({ r, s })}>{s.active ? 'Pause' : 'Resume'}</Button> },
                      ]}
                    />
                  </div>
                  <BaseMap className="h-56" label={`Route ${r.code}`}>
                    <SharedRoutePath path={r.pathGeometry} stops={r.stops.map((s) => s.pickupPoint)} />
                    {r.stops.map((s) => <Pin key={s.id} position={s.pickupPoint} kind="stop" text={String(s.sequence)} label={s.pickupPoint.name} />)}
                    <FitBounds points={r.stops.map((s) => s.pickupPoint)} />
                  </BaseMap>
                </div>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
      <Modal open={creating} onClose={() => setCreating(false)} title="New shared route">
        {creating && <RouteForm points={points.data ?? []} onDone={() => setCreating(false)} />}
      </Modal>
      <Modal open={!!scheduleFor} onClose={() => setScheduleFor(null)} title={`Departure time for ${scheduleFor?.code ?? ''}`}>
        {scheduleFor && <ScheduleForm route={scheduleFor} onDone={() => setScheduleFor(null)} />}
      </Modal>
    </div>
  );
}
