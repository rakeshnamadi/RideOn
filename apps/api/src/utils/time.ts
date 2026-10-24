export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Calendar parts of an instant as seen in an IANA timezone. */
export function localParts(date: Date, timeZone = DEFAULT_TIMEZONE) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdays.indexOf(parts.weekday!),
  };
}

/** Offset (minutes) of the timezone from UTC at the given instant. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/** Convert a local wall-clock time (date + "HH:MM") in a timezone to a UTC instant. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hhmm: string,
  timeZone = DEFAULT_TIMEZONE,
): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const guess = new Date(Date.UTC(year, month - 1, day, h, m));
  const offset = tzOffsetMinutes(guess, timeZone);
  const result = new Date(guess.getTime() - offset * 60_000);
  // Re-check across DST boundaries (not relevant for IST, but keeps the helper correct elsewhere).
  const offset2 = tzOffsetMinutes(result, timeZone);
  return offset2 === offset ? result : new Date(guess.getTime() - offset2 * 60_000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
