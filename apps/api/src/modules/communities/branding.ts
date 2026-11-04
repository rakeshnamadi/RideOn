/** Replace private logo storage fields with a public, cache-busting logo URL. */
export function withLogoUrl<T extends { id: string; logoUpdatedAt?: Date | null; logoKey?: string | null; logoMime?: string | null }>(c: T) {
  const { logoKey: _k, logoMime: _m, ...rest } = c;
  return { ...rest, logoUrl: c.logoUpdatedAt ? `/api/v1/communities/${c.id}/logo?v=${c.logoUpdatedAt.getTime()}` : null };
}
