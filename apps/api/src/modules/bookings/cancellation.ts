import type { BookingStatus, BookingType } from '@prisma/client';
import type { Actor } from './state-machine.js';

export interface CancellationPolicy {
  cancellationFreeWindowSec: number;
  cancellationFeePaise: number;
}

export interface CancellationInput {
  type: BookingType;
  status: BookingStatus;
  actor: Actor;
  now: Date;
  fareP: number; // fare the booking was quoted at (paise)
  acceptedAt?: Date | null;
  departureAt?: Date | null; // shared trips
  sharedCancellationCutoffMinutes?: number;
}

/**
 * Published cancellation rules:
 *  - Drivers, admins and the system never cause a passenger fee.
 *  - Regular: free before a driver accepts, and within the free window after acceptance.
 *    After the window, the community's flat cancellation fee applies (never more than the fare).
 *  - Shared: free until the route's cancellation cutoff before departure; after that the
 *    community fee applies, capped at the fare.
 */
export function cancellationFee(input: CancellationInput, policy: CancellationPolicy): { feePaise: number; reason: string } {
  if (input.actor !== 'PASSENGER') return { feePaise: 0, reason: 'Cancelled by driver, community or platform' };
  const cap = (fee: number) => Math.min(fee, input.fareP);

  if (input.type === 'REGULAR') {
    if (input.status === 'REQUESTED' || !input.acceptedAt) return { feePaise: 0, reason: 'No driver assigned yet' };
    const elapsed = (input.now.getTime() - input.acceptedAt.getTime()) / 1000;
    if (elapsed <= policy.cancellationFreeWindowSec) return { feePaise: 0, reason: 'Within free cancellation window' };
    return { feePaise: cap(policy.cancellationFeePaise), reason: 'Cancelled after the free cancellation window' };
  }

  if (input.status === 'REQUESTED') return { feePaise: 0, reason: 'Seat hold released before confirmation' };
  if (!input.departureAt) return { feePaise: 0, reason: 'No departure time' };
  const minutesToDeparture = (input.departureAt.getTime() - input.now.getTime()) / 60_000;
  if (minutesToDeparture >= (input.sharedCancellationCutoffMinutes ?? 0)) {
    return { feePaise: 0, reason: 'Cancelled before the route cancellation cutoff' };
  }
  return { feePaise: cap(policy.cancellationFeePaise), reason: 'Cancelled after the route cancellation cutoff' };
}
