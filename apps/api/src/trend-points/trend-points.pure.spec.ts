import { expect } from "vitest";

import {
  type TrendCatalogRow,
  type TrendDomainRow,
  type TrendOverrideRow,
  resolveSegments,
} from "./trend-points.pure";

/**
 * `F4.300` / ADR 0108 decision 3.4 — the resolution rule, with no I/O. One
 * claim per exported function; the `.test.ts` wrapper owns the `it()`s
 * (ADR 0014, AGENTS.md §4.6). Fixtures name segments here by design: the
 * ADR 0108 §5.4 guard scans runtime modules, never specs.
 */

const DOMAINS: TrendDomainRow[] = [
  { code: "hvac", label: "HVAC", sortOrder: 20, active: true },
  { code: "electrical", label: "Electrical", sortOrder: 10, active: true },
  { code: "retired", label: "Retired segment", sortOrder: 5, active: false },
  { code: "empty", label: "Empty segment", sortOrder: 30, active: true },
];

function key(code: string, domain: string | null, extra: Partial<TrendCatalogRow> = {}): TrendCatalogRow {
  return {
    code,
    name: `${code} name`,
    unit: null,
    domain,
    active: true,
    trendDefault: null,
    headlineRank: null,
    ...extra,
  };
}

const CATALOG: TrendCatalogRow[] = [
  key("kw", "electrical", { trendDefault: true, headlineRank: 2 }),
  key("pf", "electrical", { trendDefault: true, headlineRank: null }),
  key("amps", "electrical", { trendDefault: true, headlineRank: null }),
  key("volts", "electrical", { trendDefault: true, headlineRank: 1 }),
  key("hz", "electrical", { trendDefault: false, headlineRank: 3 }),
  key("old_kva", "electrical", { trendDefault: true, active: false }),
  key("supply_temp", "hvac", { trendDefault: true }),
  key("return_temp", "hvac", { trendDefault: true }),
  key("cooling_kw", "hvac", { trendDefault: null }),
  key("retired_flow", "retired", { trendDefault: true }),
];

const UPDATED_AT = new Date("2026-10-31T10:00:00.000Z");
const USER = "11111111-1111-4111-8111-111111111111";

function override(domain: string, pointKey: string, sortOrder: number): TrendOverrideRow {
  return { domain, pointKey, sortOrder, updatedAt: UPDATED_AT, updatedBy: USER };
}

const OVERRIDES: TrendOverrideRow[] = [
  override("hvac", "return_temp", 1),
  override("hvac", "cooling_kw", 0),
  override("hvac", "old_kva", 2),
];

function segment(domain: string, overrides: TrendOverrideRow[] = OVERRIDES, options = {}) {
  const found = resolveSegments(DOMAINS, CATALOG, overrides, options).find((s) => s.domain === domain);
  if (!found) {
    throw new Error(`segment ${domain} missing`);
  }
  return found;
}

/** P1 — a segment with override rows reads `source: "organization"`. */
export function assertSegmentWithRowsIsOrganization(): void {
  expect(segment("hvac").source).toBe("organization");
}

/** P2 — a segment with no override row reads `source: "catalog"`. */
export function assertSegmentWithoutRowsIsCatalog(): void {
  expect(segment("electrical").source).toBe("catalog");
}

/** P3 — the catalog list orders `headline_rank NULLS LAST, code`, and holds only `trend_default IS TRUE`. */
export function assertCatalogListOrdersByHeadlineRankThenCode(): void {
  expect(segment("electrical").points.map((p) => p.code)).toEqual(["volts", "kw", "amps", "pf"]);
}

/** P4 — the override list orders by `sort_order`, not by body arrival or code. */
export function assertOverrideListOrdersBySortOrder(): void {
  expect(segment("hvac").points.map((p) => p.code)).toEqual(["cooling_kw", "return_temp"]);
}

/** P5 — an inactive code is absent from the effective `points` (C8). */
export function assertInactiveCodeIsAbsentFromPoints(): void {
  const codes = segment("hvac").points.map((p) => p.code);
  expect(codes).not.toContain("old_kva");
  expect(codes, "adjacent positive: the active override codes are present").toContain("return_temp");
}

/** P6 — an inactive code is absent from `catalogDefaults` (C8). */
export function assertInactiveCodeIsAbsentFromCatalogDefaults(): void {
  const codes = segment("electrical").catalogDefaults.map((p) => p.code);
  expect(codes).not.toContain("old_kva");
  expect(codes, "adjacent positive: the active defaults are present").toContain("kw");
}

/** P7 — every active domain is returned even with zero points, in `sort_order` then code. */
export function assertEveryActiveDomainIsReturned(): void {
  const segments = resolveSegments(DOMAINS, CATALOG, OVERRIDES);
  expect(segments.map((s) => s.domain)).toEqual(["electrical", "hvac", "empty"]);
  expect(segments.find((s) => s.domain === "empty")).toMatchObject({
    label: "Empty segment",
    source: "catalog",
    points: [],
    catalogDefaults: [],
  });
}

/** P8 — an inactive domain is not returned, even with catalog defaults of its own. */
export function assertInactiveDomainIsNotReturned(): void {
  const domains = resolveSegments(DOMAINS, CATALOG, OVERRIDES).map((s) => s.domain);
  expect(domains).not.toContain("retired");
}

/** P9 — an override segment carries the catalog defaults beside its own list, so the page can show both. */
export function assertOverrideSegmentCarriesCatalogDefaults(): void {
  expect(segment("hvac").catalogDefaults.map((p) => p.code)).toEqual(["return_temp", "supply_temp"]);
}

/** P10 — `updatedAt`/`updatedBy` come from the override rows; a catalog segment carries nulls. */
export function assertUpdatedStampFollowsTheSource(): void {
  expect(segment("hvac")).toMatchObject({ updatedAt: UPDATED_AT.toISOString(), updatedBy: USER });
  expect(segment("electrical")).toMatchObject({ updatedAt: null, updatedBy: null });
}

/**
 * P11 — the admin read (`includeInactive`) keeps an inactive override code in
 * `points`, marked `active: false`, so the page can show the kept row (C8);
 * the catalog defaults stay active-only.
 */
export function assertAdminReadMarksInactiveOverrideCode(): void {
  const hvac = segment("hvac", OVERRIDES, { includeInactive: true });
  expect(hvac.points.map((p) => [p.code, p.active])).toEqual([
    ["cooling_kw", true],
    ["return_temp", true],
    ["old_kva", false],
  ]);
  expect(hvac.catalogDefaults.map((p) => p.code)).not.toContain("old_kva");
}

/** P12 — an organization whose only rows name inactive codes still reads `organization`, with no points. */
export function assertOverrideOfInactiveCodesOnlyStaysOrganization(): void {
  const hvac = segment("hvac", [override("hvac", "old_kva", 0)]);
  expect(hvac.source).toBe("organization");
  expect(hvac.points).toEqual([]);
}

/** P13 — an override row for an inactive domain is ignored (no segment is returned for it). */
export function assertOverrideForInactiveDomainIsIgnored(): void {
  const segments = resolveSegments(DOMAINS, CATALOG, [override("retired", "retired_flow", 0)]);
  expect(segments.map((s) => s.domain)).not.toContain("retired");
}

/** P14 — a point carries the catalog row's name and unit. */
export function assertPointCarriesNameAndUnit(): void {
  const catalog = [key("kw", "electrical", { trendDefault: true, unit: "kW", name: "Active power" })];
  const [electrical] = resolveSegments([DOMAINS[1] as TrendDomainRow], catalog, []);
  expect(electrical?.points).toEqual([{ code: "kw", name: "Active power", unit: "kW", active: true }]);
}
