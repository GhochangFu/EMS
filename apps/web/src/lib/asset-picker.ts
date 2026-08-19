import type { AssetRow } from "../api/assets";

/**
 * Narrows the affected-asset picker's candidate list (ADR 0034 decision 4).
 * `GET /api/v1/assets` is already scoped server-side to the caller's
 * readable assets, but that set can still run to hundreds of rows — this is
 * what makes a checkbox list of it usable. Matches code, name, or site name,
 * case-insensitively; an empty query returns every candidate unfiltered.
 */
export function filterAssetsByQuery(
  assets: readonly AssetRow[],
  query: string,
): AssetRow[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...assets];
  }
  return assets.filter((asset) =>
    `${asset.code} ${asset.name} ${asset.siteName}`.toLowerCase().includes(q),
  );
}

/** Adds `id` to `selected` if absent, removes it if present — a plain set toggle. */
export function toggleAssetSelection(
  selected: readonly string[],
  id: string,
): string[] {
  return selected.includes(id)
    ? selected.filter((existing) => existing !== id)
    : [...selected, id];
}
