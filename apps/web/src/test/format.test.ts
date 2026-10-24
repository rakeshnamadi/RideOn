import { describe, expect, it } from 'vitest';
import { daysLabel, humanize, inr, km, rupeesToPaise } from '@/utils/format';

describe('formatting', () => {
  it('formats paise as Indian rupees without floating-point drift', () => {
    expect(inr(4500)).toBe('₹45');
    expect(inr(4550)).toBe('₹45.50');
    expect(inr(12345600)).toBe('₹1,23,456');
    expect(inr(null)).toBe('—');
  });
  it('converts rupee inputs to integer paise', () => {
    expect(rupeesToPaise(17.5)).toBe(1750);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
  });
  it('labels distances, statuses and weekday masks', () => {
    expect(km(1949)).toBe('1.9 km');
    expect(humanize('NO_DRIVER_AVAILABLE')).toBe('No driver available');
    expect(daysLabel(127)).toBe('Every day');
    expect(daysLabel(62)).toBe('Mon–Fri');
    expect(daysLabel(0b1000001)).toBe('Sun, Sat');
  });
});
