import { cx } from '@/components/ui';

/** A union's logo, or a tile with its initials in its brand colour when it has not uploaded one. */
export function UnionMark({ name, shortName, logoUrl, brandColor, className = 'size-9' }: { name: string; shortName?: string | null; logoUrl?: string | null; brandColor?: string | null; className?: string }) {
  if (logoUrl) return <img src={logoUrl} alt="" className={cx('shrink-0 rounded-lg bg-white object-contain ring-1 ring-line', className)} />;
  const initials = (shortName || name).split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span aria-hidden className={cx('grid shrink-0 place-items-center rounded-lg bg-brand-700 text-xs font-bold text-white', className)} style={brandColor ? { backgroundColor: brandColor } : undefined}>
      {initials}
    </span>
  );
}
