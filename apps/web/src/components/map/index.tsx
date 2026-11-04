import L from 'leaflet';
import { useEffect, useMemo, type ReactNode } from 'react';
import { MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng } from '@/types';
import { cx } from '@/components/ui';

/**
 * Tile provider is configurable. The default public OSM tile server is suitable for
 * development and light use only (see docs/deployment.md); production must point
 * VITE_TILE_URL at a provider with an appropriate usage agreement.
 */
const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Ainavilli (533211), Dr. B.R. Ambedkar Konaseema, Andhra Pradesh: the primary service area. */
export const DEFAULT_CENTER: LatLng = { lat: 16.6638, lng: 82.031 };

export function BaseMap({
  center = DEFAULT_CENTER,
  zoom = 14,
  className,
  children,
  label = 'Map',
}: {
  center?: LatLng;
  zoom?: number;
  className?: string;
  children?: ReactNode;
  label?: string;
}) {
  return (
    <div className={cx('overflow-hidden rounded-xl ring-1 ring-stone-200', className ?? 'h-72')} role="region" aria-label={label}>
      <MapContainer center={[center.lat, center.lng]} zoom={zoom} className="size-full" scrollWheelZoom>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
        {children}
      </MapContainer>
    </div>
  );
}

type PinKind = 'pickup' | 'drop' | 'driver' | 'stand' | 'stop' | 'vertex';
const PIN_COLORS: Record<PinKind, string> = {
  pickup: '#047857',
  drop: '#b91c1c',
  driver: '#f59e0b',
  stand: '#0369a1',
  stop: '#57534e',
  vertex: '#7c3aed',
};

function pinIcon(kind: PinKind, text?: string) {
  const color = PIN_COLORS[kind];
  if (kind === 'vertex' || kind === 'stop') {
    const size = kind === 'vertex' ? 14 : 20;
    return L.divIcon({
      className: 'rideon-pin',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);color:#fff;font:600 10px/16px system-ui;text-align:center">${text ?? ''}</div>`,
    });
  }
  if (kind === 'driver') {
    return L.divIcon({
      className: 'rideon-pin',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      html: `<div style="width:30px;height:30px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:grid;place-items:center;font-size:15px">🛺</div>`,
    });
  }
  return L.divIcon({
    className: 'rideon-pin',
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    html: `<svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true"><path d="M14 35s12-12.2 12-21A12 12 0 0 0 2 14c0 8.8 12 21 12 21z" fill="${color}" stroke="#fff" stroke-width="2"/><text x="14" y="18" text-anchor="middle" font-family="system-ui" font-size="11" font-weight="700" fill="#fff">${text ?? (kind === 'pickup' ? 'A' : kind === 'drop' ? 'B' : 'S')}</text></svg>`,
  });
}

export function Pin({ position, kind, label, text, draggable, onDragEnd }: { position: LatLng; kind: PinKind; label?: string; text?: string; draggable?: boolean; onDragEnd?: (p: LatLng) => void }) {
  const icon = useMemo(() => pinIcon(kind, text), [kind, text]);
  return (
    <Marker
      position={[position.lat, position.lng]}
      icon={icon}
      draggable={draggable}
      keyboard
      title={label}
      eventHandlers={onDragEnd ? { dragend: (e) => onDragEnd((e.target as L.Marker).getLatLng()) } : undefined}
    >
      {label && <Tooltip direction="top" offset={[0, -28]}>{label}</Tooltip>}
    </Marker>
  );
}

export function MapClick({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

export function FitBounds({ points, maxZoom = 16 }: { points: LatLng[]; maxZoom?: number }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView([points[0]!.lat, points[0]!.lng], Math.max(map.getZoom(), 15));
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map, maxZoom]);
  return null;
}

export function RouteLine({ points, color = '#047857', dashed }: { points: [number, number][]; color?: string; dashed?: boolean }) {
  return <Polyline positions={points} pathOptions={{ color, weight: 5, opacity: 0.8, dashArray: dashed ? '6 8' : undefined }} />;
}

/** A shared route: the stored road path when available, else dashed straight segments between stops. */
export function SharedRoutePath({ path, stops }: { path: [number, number][] | null | undefined; stops: LatLng[] }) {
  return path && path.length > 1 ? (
    <RouteLine points={path} color="#0f4d3a" />
  ) : (
    <RouteLine points={stops.map((s) => [s.lat, s.lng])} color="#0f4d3a" dashed />
  );
}

export function AreaPolygon({ polygon, name, color = '#047857' }: { polygon: [number, number][]; name?: string; color?: string }) {
  return (
    <Polygon positions={polygon} pathOptions={{ color, weight: 2, fillOpacity: 0.08 }}>
      {name && <Tooltip sticky>{name}</Tooltip>}
    </Polygon>
  );
}
