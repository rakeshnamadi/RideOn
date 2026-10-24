import type { BookingStatus, BookingType } from '@prisma/client';
import { conflict } from '../../utils/errors.js';

export type Actor = 'PASSENGER' | 'DRIVER' | 'ADMIN' | 'SYSTEM';

type TransitionTable = Partial<Record<BookingStatus, Partial<Record<BookingStatus, readonly Actor[]>>>>;

/**
 * Explicit, exhaustive transition tables. Anything not listed is rejected.
 * Regular: REQUESTED → ACCEPTED → ARRIVING (driver at pickup) → IN_PROGRESS → COMPLETED
 * Shared:  REQUESTED (seats held) → CONFIRMED → IN_PROGRESS (boarded) → COMPLETED
 */
export const TRANSITIONS: Record<BookingType, TransitionTable> = {
  REGULAR: {
    REQUESTED: {
      ACCEPTED: ['DRIVER'],
      CANCELLED: ['PASSENGER', 'ADMIN', 'SYSTEM'],
      EXPIRED: ['SYSTEM'],
      NO_DRIVER_AVAILABLE: ['SYSTEM'],
    },
    ACCEPTED: {
      ARRIVING: ['DRIVER'],
      CANCELLED: ['PASSENGER', 'DRIVER', 'ADMIN'],
    },
    ARRIVING: {
      IN_PROGRESS: ['DRIVER'],
      CANCELLED: ['PASSENGER', 'DRIVER', 'ADMIN'],
      NO_SHOW: ['DRIVER'],
    },
    IN_PROGRESS: {
      COMPLETED: ['DRIVER', 'ADMIN'],
      CANCELLED: ['ADMIN'],
    },
  },
  SHARED: {
    REQUESTED: {
      CONFIRMED: ['PASSENGER'],
      CANCELLED: ['PASSENGER', 'ADMIN', 'SYSTEM'],
      EXPIRED: ['SYSTEM'],
    },
    CONFIRMED: {
      IN_PROGRESS: ['DRIVER'],
      CANCELLED: ['PASSENGER', 'ADMIN', 'SYSTEM'],
      NO_SHOW: ['DRIVER', 'SYSTEM'],
    },
    IN_PROGRESS: {
      COMPLETED: ['DRIVER', 'ADMIN', 'SYSTEM'],
      CANCELLED: ['ADMIN'],
    },
  },
};

export const TERMINAL_STATUSES: readonly BookingStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'NO_DRIVER_AVAILABLE',
  'NO_SHOW',
];

export const ACTIVE_REGULAR_STATUSES: BookingStatus[] = ['REQUESTED', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS'];

export function canTransition(type: BookingType, from: BookingStatus, to: BookingStatus, actor: Actor): boolean {
  return TRANSITIONS[type][from]?.[to]?.includes(actor) ?? false;
}

export function assertTransition(type: BookingType, from: BookingStatus, to: BookingStatus, actor: Actor) {
  if (!canTransition(type, from, to, actor)) {
    throw conflict(`Cannot move a ${type.toLowerCase()} booking from ${from} to ${to}`, 'INVALID_TRANSITION');
  }
}

export function isTerminal(status: BookingStatus) {
  return TERMINAL_STATUSES.includes(status);
}
