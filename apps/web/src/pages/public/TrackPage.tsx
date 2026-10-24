import { useParams } from 'react-router-dom';
import { BaseMap, FitBounds, Pin } from '@/components/map';
import { Card, DefinitionList, QueryState, StatusBadge } from '@/components/ui';
import { useApi } from '@/hooks/api';
import { dateTime, relative } from '@/utils/format';

interface Tracked {
  reference: string;
  status: string;
  passengerFirstName: string;
  pickup: { lat: number; lng: number; address: string | null };
  drop: { lat: number; lng: number; address: string | null };
  driverFirstName: string | null;
  vehicle: { registrationNumber: string; make: string; model: string; color: string | null } | null;
  driverLocation: { lat: number; lng: number; updatedAt: string } | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** Page a passenger shares with a trusted contact. No login; limited, time-boxed information. */
export default function TrackPage() {
  const { token } = useParams();
  const q = useApi<Tracked>(['track', token], `/track/${token}`, undefined, { refetchInterval: 10_000 });
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <QueryState query={q}>
        {(t) => (
          <div className="space-y-4">
            <Card title={`${t.passengerFirstName}'s trip`} actions={<StatusBadge status={t.status} />}>
              <DefinitionList
                items={[
                  ['Booking', t.reference],
                  ['From', t.pickup.address ?? `${t.pickup.lat.toFixed(4)}, ${t.pickup.lng.toFixed(4)}`],
                  ['To', t.drop.address ?? `${t.drop.lat.toFixed(4)}, ${t.drop.lng.toFixed(4)}`],
                  ['Driver', t.driverFirstName ?? 'Not yet assigned'],
                  ['Vehicle', t.vehicle ? `${t.vehicle.registrationNumber} · ${t.vehicle.make} ${t.vehicle.model}${t.vehicle.color ? ` (${t.vehicle.color})` : ''}` : '—'],
                  ['Started', dateTime(t.startedAt)],
                  ['Completed', dateTime(t.completedAt)],
                ]}
              />
            </Card>
            <BaseMap className="h-80" label="Trip map">
              <Pin position={t.pickup} kind="pickup" label="Pickup" />
              <Pin position={t.drop} kind="drop" label="Destination" />
              {t.driverLocation && <Pin position={t.driverLocation} kind="driver" label={`Auto, updated ${relative(t.driverLocation.updatedAt)}`} />}
              <FitBounds points={[t.pickup, t.drop, ...(t.driverLocation ? [t.driverLocation] : [])]} />
            </BaseMap>
            <p className="text-xs text-stone-500">Live location is shown only while the trip is active. This link expires automatically. In an emergency call 112.</p>
          </div>
        )}
      </QueryState>
    </div>
  );
}
