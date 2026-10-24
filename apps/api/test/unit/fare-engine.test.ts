import { describe, expect, it } from 'vitest';
import {
  calculateRegularFare,
  calculateSharedFare,
  calculateWaitingCharge,
  isNightTime,
  roundToRupee,
  type FareRuleInput,
} from '../../src/modules/fares/fare-engine.js';

const rule: FareRuleInput = {
  baseFarePaise: 3000,
  baseDistanceMeters: 2000,
  perKmPaise: 1500,
  minimumFarePaise: 3000,
  waitingPerMinutePaise: 50,
  freeWaitingMinutes: 5,
  perSeatPaise: 2000,
  perStopPaise: 500,
  nightSurchargeBps: 5000,
  nightStartHour: 22,
  nightEndHour: 5,
};
// 14:00 IST (08:30 UTC) — daytime
const day = new Date('2026-10-20T08:30:00Z');
// 23:30 IST (18:00 UTC) — night
const night = new Date('2026-10-20T18:00:00Z');

describe('regular fare', () => {
  it('charges only the base fare within the base distance', () => {
    expect(calculateRegularFare(rule, { distanceMeters: 1500, at: day }).totalPaise).toBe(3000);
  });

  it('adds the per-km rate beyond the base distance', () => {
    // 2 km base + 3 km × ₹15 = ₹30 + ₹45 = ₹75
    const r = calculateRegularFare(rule, { distanceMeters: 5000, at: day });
    expect(r.totalPaise).toBe(7500);
    expect(r.lines.map((l) => l.code)).toEqual(['BASE', 'DISTANCE']);
  });

  it('rounds to the nearest rupee and records the rounding line', () => {
    // 2.3 km extra × ₹15 = ₹34.50 → total ₹64.50 → ₹65
    const r = calculateRegularFare(rule, { distanceMeters: 4300, at: day });
    expect(r.totalPaise % 100).toBe(0);
    expect(r.totalPaise).toBe(6500);
    expect(r.lines.some((l) => l.code === 'ROUNDING')).toBe(true);
    expect(r.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(r.totalPaise);
  });

  it('applies the minimum fare', () => {
    const r = calculateRegularFare({ ...rule, baseFarePaise: 1000, minimumFarePaise: 2500 }, { distanceMeters: 500, at: day });
    expect(r.totalPaise).toBe(2500);
    expect(r.lines.find((l) => l.code === 'MINIMUM_ADJUSTMENT')?.amountPaise).toBe(1500);
  });

  it('applies the night surcharge in local (IST) time, including windows that wrap midnight', () => {
    expect(calculateRegularFare(rule, { distanceMeters: 5000, at: night }).totalPaise).toBe(11300); // ₹75 × 1.5 = ₹112.50 → ₹113
    expect(isNightTime(night, rule)).toBe(true);
    expect(isNightTime(day, rule)).toBe(false);
    expect(isNightTime(new Date('2026-10-20T23:00:00Z'), rule)).toBe(true); // 04:30 IST
  });

  it('never produces floating-point money', () => {
    for (let d = 0; d < 30_000; d += 137) {
      const r = calculateRegularFare(rule, { distanceMeters: d, at: day });
      expect(Number.isInteger(r.totalPaise)).toBe(true);
      r.lines.forEach((l) => expect(Number.isInteger(l.amountPaise)).toBe(true));
    }
  });

  it('rejects invalid distances', () => {
    expect(() => calculateRegularFare(rule, { distanceMeters: -1, at: day })).toThrow();
    expect(() => calculateRegularFare(rule, { distanceMeters: Number.NaN, at: day })).toThrow();
  });
});

describe('waiting charge', () => {
  it('is free within the free window and per-minute after', () => {
    expect(calculateWaitingCharge(rule, 4 * 60)).toBe(0);
    expect(calculateWaitingCharge(rule, 5 * 60)).toBe(0);
    expect(calculateWaitingCharge(rule, 9 * 60 + 59)).toBe(4 * 50);
  });
});

describe('shared fare', () => {
  it('charges per seat plus per extra stop', () => {
    // 3 stops travelled: ₹20 + 2 × ₹5 = ₹30 per seat, 2 seats = ₹60
    const r = calculateSharedFare(rule, { pickupSequence: 1, dropSequence: 4, seats: 2 });
    expect(r.perSeatPaise).toBe(3000);
    expect(r.totalPaise).toBe(6000);
  });

  it('applies the minimum per-seat fare', () => {
    const r = calculateSharedFare({ ...rule, perSeatPaise: 500, minimumFarePaise: 1500 }, { pickupSequence: 2, dropSequence: 3, seats: 1 });
    expect(r.totalPaise).toBe(1500);
  });

  it('rejects reversed stops and invalid seat counts', () => {
    expect(() => calculateSharedFare(rule, { pickupSequence: 3, dropSequence: 2, seats: 1 })).toThrow();
    expect(() => calculateSharedFare(rule, { pickupSequence: 1, dropSequence: 2, seats: 0 })).toThrow();
    expect(() => calculateSharedFare(rule, { pickupSequence: 1, dropSequence: 2, seats: 1.5 })).toThrow();
  });
});

describe('roundToRupee', () => {
  it('rounds half up to whole rupees', () => {
    expect(roundToRupee(6449)).toBe(6400);
    expect(roundToRupee(6450)).toBe(6500);
  });
});
