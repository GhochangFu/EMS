import type { TrendPointDto, TrendPointSegmentDto } from "@bms/shared";

/**
 * `F4.300` / ADR 0108 decision 3.4 — the trend-point resolution rule, with no
 * I/O: **an organization with any row for a segment uses those rows; otherwise
 * the catalog default applies.** A segment is an `asset_domains` row (data, never
 * code), so nothing here names one — ADR 0108 §5.4's guard scans this file.
 *
 * - The catalog default list is every active `point_keys` row of the segment
 *   with `trend_default IS TRUE`, ordered `headline_rank NULLS LAST, code`
 *   (ADR 0108 §3.1: no `trend_rank` column).
 * - An organization list orders by its own `sort_order`.
 * - An inactive point key is left out of the effective list and its override
 *   row is kept (plan C8). The admin read passes `includeInactive` so the page
 *   can show the kept row, marked `active: false`; a later reactivation brings
 *   it back on the site read with no write.
 * - Only active segments are returned, each one even with zero points, in
 *   `asset_domains.sort_order` then code — the consumer chooses which to show.
 */

export type TrendDomainRow = {
  code: string;
  label: string;
  sortOrder: number;
  active: boolean;
};

export type TrendCatalogRow = {
  code: string;
  name: string;
  unit: string | null;
  domain: string | null;
  active: boolean;
  trendDefault: boolean | null;
  headlineRank: number | null;
};

export type TrendOverrideRow = {
  domain: string;
  pointKey: string;
  sortOrder: number;
  updatedAt: Date;
  updatedBy: string | null;
};

export type ResolveOptions = {
  /** The admin read: keep an inactive override code in `points`, marked inactive. */
  includeInactive?: boolean;
};

function toPoint(row: TrendCatalogRow): TrendPointDto {
  return { code: row.code, name: row.name, unit: row.unit, active: row.active };
}

/** `headline_rank NULLS LAST, code` — the generated site card's order (ADR 0076). */
function byHeadlineRankThenCode(a: TrendCatalogRow, b: TrendCatalogRow): number {
  if (a.headlineRank !== b.headlineRank) {
    if (a.headlineRank === null) return 1;
    if (b.headlineRank === null) return -1;
    return a.headlineRank - b.headlineRank;
  }
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

function byCode(a: { code: string }, b: { code: string }): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

/** The latest stamp among one segment's rows (replace-all writes one stamp; this is defensive). */
function latest(rows: readonly TrendOverrideRow[]): TrendOverrideRow | undefined {
  let found: TrendOverrideRow | undefined;
  for (const row of rows) {
    if (found === undefined || row.updatedAt.getTime() > found.updatedAt.getTime()) {
      found = row;
    }
  }
  return found;
}

export function resolveSegments(
  domains: readonly TrendDomainRow[],
  catalog: readonly TrendCatalogRow[],
  overrides: readonly TrendOverrideRow[],
  options: ResolveOptions = {},
): TrendPointSegmentDto[] {
  const byCodeMap = new Map(catalog.map((row) => [row.code, row]));
  const active = domains
    .filter((domain) => domain.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || byCode(a, b));

  return active.map((domain) => {
    const catalogDefaults = catalog
      .filter((row) => row.domain === domain.code && row.active && row.trendDefault === true)
      .sort(byHeadlineRankThenCode)
      .map(toPoint);

    const rows = overrides
      .filter((row) => row.domain === domain.code)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (rows.length === 0) {
      return {
        domain: domain.code,
        label: domain.label,
        source: "catalog" as const,
        points: catalogDefaults,
        catalogDefaults,
        updatedAt: null,
        updatedBy: null,
      };
    }

    const points: TrendPointDto[] = [];
    for (const row of rows) {
      const key = byCodeMap.get(row.pointKey);
      if (key && (key.active || options.includeInactive === true)) {
        points.push(toPoint(key));
      }
    }
    const stamp = latest(rows);
    return {
      domain: domain.code,
      label: domain.label,
      source: "organization" as const,
      points,
      catalogDefaults,
      updatedAt: stamp ? stamp.updatedAt.toISOString() : null,
      updatedBy: stamp?.updatedBy ?? null,
    };
  });
}
