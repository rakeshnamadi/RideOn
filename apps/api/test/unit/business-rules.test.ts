import { describe, expect, it } from 'vitest';
import { cancellationFee } from '../../src/modules/bookings/cancellation.js';
import { canTransition, assertTransition, TRANSITIONS, isTerminal } from '../../src/modules/bookings/state-machine.js';
import { validateFareProposal, DEFAULT_FARE_CAPS } from '../../src/modules/fares/governance.service.js';
import { calculateFeeSplit } from '../../src/modules/payments/fees.js';
import { haversineMeters, isValidPolygon, pointInPolygon } from '../../src/utils/geo.js';
import { localParts, zonedTimeToUtc } from '../../src/utils/time.js';

describe('booking state machine', () => {
  it('allows the regular happy path only in order and only by the right actor', () => {
    expect(canTransition('REGULAR', 'REQUESTED', 'ACCEPTED', 'DRIVER')).toBe(true);
    expect(canTransition('REGULAR', 'ACCEPTED', 'ARRIVING', 'DRIVER')).toBe(true);
    expect(canTransition('REGULAR', 'ARRIVING', 'IN_PROGRESS', 'DRIVER')).toBe(true);
    expect(canTransition('REGULAR', 'IN_PROGRESS', 'COMPLETED', 'DRIVER')).toBe(true);
    // skipping states or wrong actor
    expect(canTransition('REGULAR', 'REQUESTED', 'IN_PROGRESS', 'DRIVER')).toBe(false);
    expect(canTransition('REGULAR', 'ACCEPTED', 'COMPLETED', 'DRIVER')).toBe(false);
    expect(canTransition('REGULAR', 'REQUESTED', 'ACCEPTED', 'PASSENGER')).toBe(false);
    expect(canTransition('REGULAR', 'IN_PROGRESS', 'CANCELLED', 'PASSENGER')).toBe(false);
  });

  it('never leaves a terminal state', () => {
    for (const type of ['REGULAR', 'SHARED'] as const) {
      for (const from of ['COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_DRIVER_AVAILABLE', 'NO_SHOW'] as const) {
        expect(isTerminal(from)).toBe(true);
        expect(TRANSITIONS[type][from]).toBeUndefined();
      }
    }
  });

  it('models shared bookings separately (hold → confirm → board → complete)', () => {
    expect(canTransition('SHARED', 'REQUESTED', 'CONFIRMED', 'PASSENGER')).toBe(true);
    expect(canTransition('SHARED', 'CONFIRMED', 'IN_PROGRESS', 'DRIVER')).toBe(true);
    expect(canTransition('SHARED', 'REQUESTED', 'ACCEPTED', 'DRIVER')).toBe(false);
    expect(() => assertTransition('SHARED', 'COMPLETED', 'CANCELLED', 'ADMIN')).toThrow(/Cannot move/);
  });
});

describe('cancellation rules', () => {
  const policy = { cancellationFreeWindowSec: 120, cancellationFeePaise: 2000 };
  const now = new Date('2026-10-20T10:00:00Z');

  it('is free before a driver is assigned', () => {
    expect(cancellationFee({ type: 'REGULAR', status: 'REQUESTED', actor: 'PASSENGER', now, fareP: 8000 }, policy).feePaise).toBe(0);
  });
  it('is free within the window after acceptance and charged after', () => {
    const acceptedAt = new Date(now.getTime() - 60_000);
    expect(cancellationFee({ type: 'REGULAR', status: 'ACCEPTED', actor: 'PASSENGER', now, fareP: 8000, acceptedAt }, policy).feePaise).toBe(0);
    const late = new Date(now.getTime() - 300_000);
    expect(cancellationFee({ type: 'REGULAR', status: 'ACCEPTED', actor: 'PASSENGER', now, fareP: 8000, acceptedAt: late }, policy).feePaise).toBe(2000);
  });
  it('never exceeds the fare and never charges when the driver or admin cancels', () => {
    const late = new Date(now.getTime() - 300_000);
    expect(cancellationFee({ type: 'REGULAR', status: 'ARRIVING', actor: 'PASSENGER', now, fareP: 1500, acceptedAt: late }, policy).feePaise).toBe(1500);
    expect(cancellationFee({ type: 'REGULAR', status: 'ARRIVING', actor: 'DRIVER', now, fareP: 8000, acceptedAt: late }, policy).feePaise).toBe(0);
    expect(cancellationFee({ type: 'REGULAR', status: 'ARRIVING', actor: 'ADMIN', now, fareP: 8000, acceptedAt: late }, policy).feePaise).toBe(0);
  });
  it('uses the route cutoff for shared bookings', () => {
    const departureAt = new Date(now.getTime() + 30 * 60_000);
    expect(cancellationFee({ type: 'SHARED', status: 'CONFIRMED', actor: 'PASSENGER', now, fareP: 4000, departureAt, sharedCancellationCutoffMinutes: 15 }, policy).feePaise).toBe(0);
    const soon = new Date(now.getTime() + 10 * 60_000);
    expect(cancellationFee({ type: 'SHARED', status: 'CONFIRMED', actor: 'PASSENGER', now, fareP: 4000, departureAt: soon, sharedCancellationCutoffMinutes: 15 }, policy).feePaise).toBe(2000);
  });
});

describe('platform fee split', () => {
  const cfg = { platformFeeBps: 500, platformFlatFeePaise: 0, platformMaxFeePaise: 2000, communityFeeBps: 200 };
  it('splits fare into platform, community and driver shares that sum exactly', () => {
    const s = calculateFeeSplit(10_000, cfg);
    expect(s).toEqual({ farePaise: 10_000, platformFeePaise: 500, communityFeePaise: 200, processingFeePaise: 0, driverNetPaise: 9300 });
  });
  it('caps the platform fee', () => {
    expect(calculateFeeSplit(100_000, cfg).platformFeePaise).toBe(2000);
  });
  it('sums exactly for every fare (no money created or lost)', () => {
    for (let f = 0; f < 50_000; f += 173) {
      const s = calculateFeeSplit(f, { ...cfg, platformFlatFeePaise: 300, processingFeePaise: 150 });
      expect(s.platformFeePaise + s.communityFeePaise + s.processingFeePaise + s.driverNetPaise).toBe(f);
      expect(s.driverNetPaise).toBeGreaterThanOrEqual(0);
    }
  });
  it('rejects invalid input', () => {
    expect(() => calculateFeeSplit(10.5, cfg)).toThrow();
    expect(() => calculateFeeSplit(100, { ...cfg, platformFeeBps: 20_000 })).toThrow();
  });
});

describe('fare proposal validation', () => {
  const policy = { allowDistanceFares: true, maxFareIncreasePercent: 20 };
  const base = { serviceType: 'REGULAR' as const, baseFarePaise: 3000, baseDistanceMeters: 2000, perKmPaise: 1500, minimumFarePaise: 3000, waitingPerMinutePaise: 50, freeWaitingMinutes: 5, perSeatPaise: 0, perStopPaise: 0, nightSurchargeBps: 5000, nightStartHour: 22, nightEndHour: 5 };

  it('accepts a fare within platform caps', () => {
    expect(validateFareProposal(base, DEFAULT_FARE_CAPS, policy, base).violations).toEqual([]);
  });
  it('rejects fares above regulatory caps', () => {
    const r = validateFareProposal({ ...base, perKmPaise: 5000 }, DEFAULT_FARE_CAPS, policy, base);
    expect(r.violations.join()).toMatch(/Per-km rate/);
  });
  it('rejects distance fares when the community is not permitted to use them', () => {
    const r = validateFareProposal(base, DEFAULT_FARE_CAPS, { ...policy, allowDistanceFares: false }, null);
    expect(r.violations.join()).toMatch(/Distance-based fares/);
  });
  it('flags increases above the community limit for platform review', () => {
    const r = validateFareProposal({ ...base, baseFarePaise: 4000 }, DEFAULT_FARE_CAPS, policy, base);
    expect(r.maxIncreasePercent).toBeCloseTo(33.3, 1);
    expect(r.exceedsIncreaseLimit).toBe(true);
    expect(validateFareProposal({ ...base, baseFarePaise: 3500 }, DEFAULT_FARE_CAPS, policy, base).exceedsIncreaseLimit).toBe(false);
  });
});

describe('geo helpers', () => {
  const square: [number, number][] = [[12.95, 77.6], [12.95, 77.65], [12.9, 77.65], [12.9, 77.6]];
  it('detects points inside and outside a service area', () => {
    expect(pointInPolygon({ lat: 12.93, lng: 77.62 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 12.97, lng: 77.62 }, square)).toBe(false);
  });
  it('validates polygons', () => {
    expect(isValidPolygon(square)).toBe(true);
    expect(isValidPolygon([[1, 2], [3, 4]])).toBe(false);
    expect(isValidPolygon([[100, 2], [3, 4], [5, 6]])).toBe(false);
  });
  it('computes haversine distance', () => {
    // Sony World → Silk Board, roughly 2.2 km in a straight line
    const d = haversineMeters({ lat: 12.937, lng: 77.6267 }, { lat: 12.9177, lng: 77.6233 });
    expect(d).toBeGreaterThan(2000);
    expect(d).toBeLessThan(2400);
  });
});

describe('timezone helpers', () => {
  it('converts IST wall-clock times to UTC', () => {
    expect(zonedTimeToUtc(2026, 10, 25, '07:30').toISOString()).toBe('2026-10-25T02:00:00.000Z');
    expect(zonedTimeToUtc(2026, 10, 25, '00:15').toISOString()).toBe('2026-10-24T18:45:00.000Z');
  });
  it('reads local parts in IST', () => {
    const p = localParts(new Date('2026-10-24T20:00:00Z'));
    expect(p).toMatchObject({ year: 2026, month: 10, day: 25, hour: 1, minute: 30, weekday: 0 });
  });
});
