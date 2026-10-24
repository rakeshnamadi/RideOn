import { MapPin, Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '@/services/api';
import type { LatLng } from '@/types';

interface Place {
  label: string;
  lat: number;
  lng: number;
}

/**
 * Address search through the backend geocoding proxy (which caches and rate-limits
 * per the provider's policy). Debounced, minimum 3 characters. When the provider is
 * unavailable the user is told to pick the point on the map instead.
 */
export function PlaceSearch({ label, value, onSelect, near }: { label: string; value: string; onSelect: (p: LatLng & { label: string }) => void; near?: LatLng }) {
  const id = useId();
  const [q, setQ] = useState(value);
  const [results, setResults] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => setQ(value), [value]);

  useEffect(() => {
    if (!open || q.trim().length < 3 || q === value) return;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<Place[]>('/geo/search', { q: q.trim(), lat: near?.lat, lng: near?.lng });
        setResults(res.data);
        if (res.data.length === 0) setError('No matches. Try another name or tap the map.');
      } catch (e) {
        setResults([]);
        setError(e instanceof ApiError ? e.message : 'Search unavailable. Tap the map to choose the location.');
      } finally {
        setLoading(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [q, open, value, near?.lat, near?.lng]);

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-stone-700">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden />
        <input
          id={id}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Search a place or tap the map"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          className="block w-full rounded-lg border-0 bg-white py-2 pl-9 pr-3 text-sm ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-600 focus:outline-none"
        />
      </div>
      {open && (loading || error || results.length > 0) && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-stone-200">
          {loading && <li className="px-3 py-2 text-stone-500">Searching…</li>}
          {!loading && error && <li className="px-3 py-2 text-stone-600">{error}</li>}
          {!loading &&
            results.map((r) => (
              <li key={`${r.lat},${r.lng}`} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-stone-100"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect({ lat: r.lat, lng: r.lng, label: r.label });
                    setQ(r.label);
                    setOpen(false);
                  }}
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-stone-400" aria-hidden />
                  <span className="line-clamp-2">{r.label}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
