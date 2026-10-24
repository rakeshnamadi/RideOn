const TZ = 'Asia/Kolkata';

/** Paise → "₹75" (or "₹75.50" when there are paise). Money is never handled as floating rupees elsewhere. */
export function inr(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export const rupeesToPaise = (r: number) => Math.round(r * 100);
export const paiseToRupees = (p: number) => p / 100;

export function dateTime(iso: string | Date | null | undefined) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(new Date(iso));
}

export function time(iso: string | Date | null | undefined) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(new Date(iso));
}

export function date(iso: string | Date | null | undefined) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: TZ }).format(new Date(iso));
}

export function km(meters: number | null | undefined) {
  if (meters === null || meters === undefined) return '—';
  return `${(meters / 1000).toFixed(1)} km`;
}

export function minutes(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function humanize(value: string | null | undefined) {
  if (!value) return '—';
  return value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function relative(iso: string | Date) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/** OSM directions link for drivers (opens in the browser or a maps app). */
export function directionsUrl(from: { lat: number; lng: number } | null, to: { lat: number; lng: number }) {
  const route = from ? `${from.lat},${from.lng};${to.lat},${to.lng}` : `;${to.lat},${to.lng}`;
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(route)}`;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function daysLabel(mask: number) {
  if (mask === 127) return 'Every day';
  if (mask === 62) return 'Mon–Fri';
  return WEEKDAYS.filter((_, i) => mask & (1 << i)).join(', ');
}
