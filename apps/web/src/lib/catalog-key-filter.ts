/**
 * `F4.313` follow-up (owner ruling 2026-11-05) — which catalog keys the
 * calculated-point key picker (`CatalogKeySelect`) lists. Domain first: by
 * default only the active keys whose `domain` equals the asset's; **Show all
 * keys** lifts that filter; a search narrows what is left by code or name.
 * The keys the caller excludes (the asset already has them) stay out in every
 * mode. A rule about the list only — a calculated point still names a catalog
 * key, and the server checks it as before.
 */

/** The catalog fields the filter reads (a subset of `AdminPointKeyDto`). */
export type FilterableCatalogKey = {
  readonly code: string;
  readonly name: string;
  readonly domain: string | null;
};

export type CatalogKeyFilter = {
  /** Codes never listed — the keys the asset already has. */
  readonly exclude: ReadonlySet<string>;
  /** The asset's domain; `null` lists every domain (no domain known, or mixed). */
  readonly domain: string | null;
  /** **Show all keys**: ignore `domain`. */
  readonly showAll: boolean;
  /** The search text; matched case-insensitively against code and name. */
  readonly search: string;
  /**
   * The key currently picked: listed even when the domain or the search would
   * hide it, so the `<select>` never holds a value it has no option for.
   */
  readonly selected: string;
};

/** The keys the picker lists, in catalog order. */
export function visibleCatalogKeys<T extends FilterableCatalogKey>(
  items: readonly T[],
  { exclude, domain, showAll, search, selected }: CatalogKeyFilter,
): T[] {
  const needle = search.trim().toLowerCase();
  return items.filter((item) => {
    if (exclude.has(item.code)) return false;
    if (item.code === selected) return true;
    if (!showAll && domain !== null && item.domain !== domain) return false;
    if (needle === "") return true;
    return item.code.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle);
  });
}

/**
 * The bulk wizard's domain: the one every selected asset shares, or `null`
 * (list all keys) when they differ or nothing is selected.
 */
export function sharedDomain(domains: readonly string[]): string | null {
  const [first] = domains;
  if (first === undefined) return null;
  return domains.every((domain) => domain === first) ? first : null;
}
