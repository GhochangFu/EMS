import type { AssetDomainDto } from "@bms/shared";

import type { AssetRow } from "../api/assets";

/**
 * `F3.31` — the pure rules behind the `/assets` operator browser (ADR 0068
 * decisions 1 and 3). Kept out of the `.tsx` files so each rule is a plain
 * function a node spec can call, and so it sits inside the web coverage
 * `include` (`src/lib/**`), which the page and the panel do not.
 */

export type AssetRowFilters = {
  /** Free text, matched against `code` and `name` only. */
  query: string;
  /** A domain code; `""` means every domain. */
  domain: string;
  /** A `siteName`; `""` means every site. */
  site: string;
};

/**
 * Narrows the list client-side. The three filters compose as AND.
 *
 * **`query` reads `code` and `name` — not `siteName`.** ADR 0068 decision 1
 * names code and name for the text filter and gives the site its own select;
 * a text match on the site would make the site filter redundant and would
 * surface every asset on a site for a query meant to find one. That is why
 * `filterAssetsByQuery` (`asset-picker.ts`), which does match the site, is not
 * reused here.
 */
export function filterAssetRows(
  rows: readonly AssetRow[],
  filters: AssetRowFilters,
): AssetRow[] {
  const q = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.domain && row.domain !== filters.domain) return false;
    if (filters.site && row.siteName !== filters.site) return false;
    if (!q) return true;
    return row.code.toLowerCase().includes(q) || row.name.toLowerCase().includes(q);
  });
}

/** Distinct `siteName`s, sorted — the site select's options. */
export function siteOptions(rows: readonly AssetRow[]): string[] {
  return [...new Set(rows.map((row) => row.siteName))].sort((a, b) => a.localeCompare(b));
}

/** The vocabulary label for a domain code, or the bare code when the vocabulary has no row. */
export function domainLabel(code: string, domains: readonly AssetDomainDto[]): string {
  return domains.find((domain) => domain.code === code)?.label ?? code;
}

/**
 * The empty-dashboards sentence (ADR 0068 decision 3, plan-gate ruling 6).
 * `templateId === null` means the asset was created by hand, so `F3.2` had no
 * template to instantiate default dashboards from — the sentence says so
 * rather than leaving the operator to wonder why the list is empty.
 */
export function noDashboardsSentence(templateId: string | null): string {
  return templateId === null
    ? "No dashboards for this asset — it was created by hand, so there is no template to instantiate them from."
    : "No dashboards for this asset.";
}

/** The Active column's pill text. */
export function activeLabel(active: boolean): string {
  return active ? "Active" : "Inactive";
}
