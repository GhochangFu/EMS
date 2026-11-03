import { energyViewRangeSchema, type EnergyFilterOptions, type EnergyViewRange } from "@bms/shared";

import type { RangeCompareValue } from "../components/energy/range-compare-controls";
import type { SiteRankingSort } from "./energy-organization-views";
import { type EnergyFilterValue, defaultFilter } from "./energy-view-filter";
import { ENERGY_VIEW, pointFromSearch, viewFromSearch } from "./site-trends";

/**
 * `F4.303` U6 (ADR 0108 Amendment 6 item 2) — every piece of view state in the URL, so the
 * address bar is the link. One parse rule for the Energy page and the site Trends & Energy
 * section, on the `rangeFromSearch` precedent (`asset-history-range.ts`): a value that does not
 * parse (a non-uuid id, an unknown range or sort, an instant that is not ISO) is dropped and the
 * default applies, never a throw. The defaults (`defaultFilter`, `24h`, `stackBy=site`,
 * `rankBy=kwh`) are not written, so a bare path stays bare.
 *
 * Ids and codes only: organization and location ids, point and segment codes, enum values and
 * ISO instants — no name and no personal data. A custom range is written as `from` and `to`
 * (`toISOString()` form) with no `range` key; while one end is missing (a picker being
 * cleared) it is written as `range=custom` and the end it has, so the pickers stay on screen.
 */

/** How the Energy page stacks its load profile. */
export type StackBy = "site" | "source";

/** The Energy page's state as the URL holds it. `range` absent is the `24h` default. */
export type EnergyLink = {
  organizationId?: string;
  locationIds: string[];
  range?: EnergyViewRange;
  from?: string;
  to?: string;
  compare: boolean;
  stackBy: StackBy;
  rankBy: SiteRankingSort;
};

/** The Trends & Energy section's state as the URL holds it; the site is in the path. */
export type TrendsLink = {
  view: string;
  point?: string;
  value: RangeCompareValue;
  rankBy: SiteRankingSort;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DEFAULT_RANGE: EnergyViewRange = "24h";const DEFAULT_STACK_BY: StackBy = "site";
const DEFAULT_RANK_BY: SiteRankingSort = "kwh";

// Records, so a new sort or stack key that is not listed here fails the type check.
const STACK_BY_KEYS: Record<StackBy, true> = { site: true, source: true };
const RANK_BY_KEYS: Record<SiteRankingSort, true> = { kwh: true, peakKw: true, kwhPerM2: true };

function keyOf<K extends string>(keys: Record<K, true>, value: string | null): K | undefined {
  return value !== null && Object.prototype.hasOwnProperty.call(keys, value) ? (value as K) : undefined;
}

function uuidOf(value: string): string | undefined {
  return UUID.test(value) ? value : undefined;
}

/** An ISO instant in the `toISOString()` form, or `undefined` when it is not one. */
function instantOf(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || !ISO_INSTANT.test(value)) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

type RangePart = { range?: EnergyViewRange; from?: string; to?: string };

function readRange(params: URLSearchParams): RangePart {
  const range = energyViewRangeSchema.safeParse(params.get("range"));
  const from = instantOf(params.get("from"));
  const to = instantOf(params.get("to"));
  if (range.success && range.data !== "custom") {
    return { range: range.data };
  }
  if ((from !== undefined && to !== undefined) || (range.success && (from !== undefined || to !== undefined))) {
    return { range: "custom", ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
  }
  return {};
}

function writeRange(params: URLSearchParams, part: RangePart): void {
  if (part.range !== "custom") {
    if (part.range !== undefined && part.range !== DEFAULT_RANGE) {
      params.set("range", part.range);
    }
    return;
  }
  const from = instantOf(part.from);
  const to = instantOf(part.to);
  if (from === undefined || to === undefined) {
    if (from === undefined && to === undefined) {
      return;
    }
    params.set("range", "custom");
  }
  if (from !== undefined) {
    params.set("from", from);
  }
  if (to !== undefined) {
    params.set("to", to);
  }
}

/** The Energy page's defaults: the reader's first organization, the whole of it, the last 24 h. */
export function defaultEnergyLink(): EnergyLink {
  return { locationIds: [], compare: false, stackBy: DEFAULT_STACK_BY, rankBy: DEFAULT_RANK_BY };
}

/** Reads the Energy page's state; anything unreadable falls to the default. */
export function energyLinkFromSearch(params: URLSearchParams): EnergyLink {
  const organizationId = uuidOf(params.get("organizationId") ?? "");
  const locationIds = [
    ...new Set(
      (params.get("locationIds") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => uuidOf(id) !== undefined),
    ),
  ];
  return {
    ...(organizationId !== undefined ? { organizationId } : {}),
    locationIds,
    ...readRange(params),
    compare: params.get("compare") === "1",
    stackBy: keyOf(STACK_BY_KEYS, params.get("stackBy")) ?? DEFAULT_STACK_BY,
    rankBy: keyOf(RANK_BY_KEYS, params.get("rankBy")) ?? DEFAULT_RANK_BY,
  };
}

/** The URL form of {@link EnergyLink}; a default writes no key. */
export function energyLinkToSearch(link: EnergyLink): URLSearchParams {
  const params = new URLSearchParams();
  if (link.organizationId !== undefined) {
    params.set("organizationId", link.organizationId);
  }
  if (link.locationIds.length > 0) {
    params.set("locationIds", link.locationIds.join(","));
  }
  writeRange(params, link);
  if (link.compare) {
    params.set("compare", "1");
  }
  if (link.stackBy !== DEFAULT_STACK_BY) {
    params.set("stackBy", link.stackBy);
  }
  if (link.rankBy !== DEFAULT_RANK_BY) {
    params.set("rankBy", link.rankBy);
  }
  return params;
}

/**
 * The filter a link asks for, or `null` when it names an organization or a location that the
 * reader's `energy/filter-options` do not list — such a link is never sent (a link never widens
 * access, and the page says so with a fixed sentence).
 */
export function energyFilterOfLink(link: EnergyLink, options: EnergyFilterOptions): EnergyFilterValue | null {
  if (link.organizationId !== undefined && !options.organizations.some((o) => o.id === link.organizationId)) {
    return null;
  }
  if (link.locationIds.some((id) => !options.locations.some((location) => location.id === id))) {
    return null;
  }
  const base = defaultFilter(options);
  return {
    organizationId: link.organizationId ?? base.organizationId,
    locationIds: [...link.locationIds],
    range: link.range ?? base.range,
    ...(link.from !== undefined ? { from: link.from } : {}),
    ...(link.to !== undefined ? { to: link.to } : {}),
    ...(link.compare ? { compare: "previous" as const } : {}),
  };
}

/**
 * The link of the page's filter and its two view choices. The organization is left out only when
 * the whole state is the default — then the search is empty; any other state names it, so the
 * link opens the same organization for a reader whose first organization is another.
 */
export function energyLinkOfFilter(
  filter: EnergyFilterValue,
  options: EnergyFilterOptions,
  stackBy: StackBy,
  rankBy: SiteRankingSort,
): EnergyLink {
  const link: EnergyLink = {
    locationIds: [...filter.locationIds],
    range: filter.range,
    ...(filter.from !== undefined ? { from: filter.from } : {}),
    ...(filter.to !== undefined ? { to: filter.to } : {}),
    compare: filter.compare === "previous",
    stackBy,
    rankBy,
  };
  const othersWritten = energyLinkToSearch(link).toString() !== "";
  if (filter.organizationId !== "" && (othersWritten || filter.organizationId !== defaultFilter(options).organizationId)) {
    link.organizationId = filter.organizationId;
  }
  return link;
}

/** Reads the Trends & Energy section's state; anything unreadable falls to the default. */
export function trendsLinkFromSearch(params: URLSearchParams): TrendsLink {
  const range = readRange(params);
  const point = pointFromSearch(params);
  return {
    view: viewFromSearch(params),
    ...(point !== undefined ? { point } : {}),
    value: {
      range: range.range ?? DEFAULT_RANGE,
      ...(range.from !== undefined ? { from: range.from } : {}),
      ...(range.to !== undefined ? { to: range.to } : {}),
      ...(params.get("compare") === "1" ? { compare: "previous" as const } : {}),
    },
    rankBy: keyOf(RANK_BY_KEYS, params.get("rankBy")) ?? DEFAULT_RANK_BY,
  };
}

/**
 * The one writer of the section's search: `""` at the defaults, else `?…`. The Energy sub-tab
 * writes no `view` and no `point`; a segment sub-tab writes its domain code and its point.
 */
export function trendsLinkToSearch(link: TrendsLink): string {
  const params = new URLSearchParams();
  if (link.view !== ENERGY_VIEW) {
    params.set("view", link.view);
    if (link.point !== undefined) {
      params.set("point", link.point);
    }
  }
  writeRange(params, link.value);
  if (link.value.compare === "previous") {
    params.set("compare", "1");
  }
  if (link.rankBy !== DEFAULT_RANK_BY) {
    params.set("rankBy", link.rankBy);
  }
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}
