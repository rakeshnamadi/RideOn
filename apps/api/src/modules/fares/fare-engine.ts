/**
 * Pure fare calculation. All amounts are integer paise. No I/O here: the service
 * layer loads the applicable rule and passes it in, which keeps the rules testable.
 */
import { localParts } from '../../utils/time.js';

export interface FareRuleInput {
  baseFarePaise: number;
  baseDistanceMeters: number;
  perKmPaise: number;
  minimumFarePaise: number;
  waitingPerMinutePaise: number;
  freeWaitingMinutes: number;
  perSeatPaise: number;
  perStopPaise: number;
  nightSurchargeBps: number;
  nightStartHour: number;
  nightEndHour: number;
}

export interface FareLine {
  code: string;
  label: string;
  amountPaise: number;
}

export interface FareResult {
  totalPaise: number;
  lines: FareLine[];
}

/** Round to the nearest whole rupee, the way auto fares are collected in practice. */
export function roundToRupee(paise: number): number {
  return Math.round(paise / 100) * 100;
}

export function isNightTime(at: Date, rule: Pick<FareRuleInput, 'nightStartHour' | 'nightEndHour'>, timeZone?: string) {
  const { hour } = localParts(at, timeZone);
  const { nightStartHour: s, nightEndHour: e } = rule;
  if (s === e) return false;
  return s < e ? hour >= s && hour < e : hour >= s || hour < e; // window may wrap midnight
}

export function calculateRegularFare(
  rule: FareRuleInput,
  trip: { distanceMeters: number; at: Date; timeZone?: string },
): FareResult {
  if (trip.distanceMeters < 0 || !Number.isFinite(trip.distanceMeters)) throw new Error('Invalid distance');
  const lines: FareLine[] = [{ code: 'BASE', label: `Base fare (first ${(rule.baseDistanceMeters / 1000).toFixed(1)} km)`, amountPaise: rule.baseFarePaise }];

  const extraMeters = Math.max(0, trip.distanceMeters - rule.baseDistanceMeters);
  if (extraMeters > 0 && rule.perKmPaise > 0) {
    lines.push({
      code: 'DISTANCE',
      label: `Distance charge (${(extraMeters / 1000).toFixed(1)} km)`,
      amountPaise: Math.round((extraMeters * rule.perKmPaise) / 1000),
    });
  }

  let subtotal = lines.reduce((s, l) => s + l.amountPaise, 0);
  if (subtotal < rule.minimumFarePaise) {
    lines.push({ code: 'MINIMUM_ADJUSTMENT', label: 'Minimum fare adjustment', amountPaise: rule.minimumFarePaise - subtotal });
    subtotal = rule.minimumFarePaise;
  }

  if (rule.nightSurchargeBps > 0 && isNightTime(trip.at, rule, trip.timeZone)) {
    lines.push({
      code: 'NIGHT',
      label: `Night charge (${rule.nightSurchargeBps / 100}%)`,
      amountPaise: Math.round((subtotal * rule.nightSurchargeBps) / 10_000),
    });
  }

  return finalise(lines);
}

/** Waiting charge after the free waiting period, computed when the trip starts. */
export function calculateWaitingCharge(rule: FareRuleInput, waitedSeconds: number): number {
  const chargeableMinutes = Math.max(0, Math.floor(waitedSeconds / 60) - rule.freeWaitingMinutes);
  return chargeableMinutes * rule.waitingPerMinutePaise;
}

/**
 * Shared autos: a per-seat fare plus a per-stop increment for each stop travelled
 * beyond the first, multiplied by seats.
 */
export function calculateSharedFare(
  rule: FareRuleInput,
  trip: { pickupSequence: number; dropSequence: number; seats: number },
): FareResult & { perSeatPaise: number } {
  if (trip.dropSequence <= trip.pickupSequence) throw new Error('Drop stop must come after pickup stop');
  if (!Number.isInteger(trip.seats) || trip.seats < 1) throw new Error('Seat count must be a positive integer');
  const segments = trip.dropSequence - trip.pickupSequence;
  let perSeat = rule.perSeatPaise + rule.perStopPaise * (segments - 1);
  perSeat = Math.max(perSeat, rule.minimumFarePaise);
  perSeat = roundToRupee(perSeat);
  const lines: FareLine[] = [
    { code: 'SEAT', label: `Seat fare × ${trip.seats} (${segments} stop${segments > 1 ? 's' : ''})`, amountPaise: perSeat * trip.seats },
  ];
  return { totalPaise: perSeat * trip.seats, lines, perSeatPaise: perSeat };
}

function finalise(lines: FareLine[]): FareResult {
  const raw = lines.reduce((s, l) => s + l.amountPaise, 0);
  const total = roundToRupee(raw);
  if (total !== raw) lines.push({ code: 'ROUNDING', label: 'Rounding', amountPaise: total - raw });
  return { totalPaise: total, lines };
}
