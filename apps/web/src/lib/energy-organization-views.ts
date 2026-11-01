import type {
  EnergyAbnormalEntry,
  EnergyHeatmapCell,
  EnergyOrganizationViews,
  EnergySiteEnergy,
  EnergySiteTrend,
} from "@bms/shared";

import { seriesPalette } from "./chart-theme";
import type { EnergyStack } from "./energy-stack-option";
import type { Roles } from "./theme";

/**
 * `F4.299` U5 (ADR 0108 Amendment 1) — the pure helpers behind the Energy page's
 * four organization views. Nothing here reads a clock or the browser's zone; the
 * server has already placed every figure in the view's zone.
 */

/** The percent change of `now` against `before`; `null` when `before` is zero (never `Infinity`). */
export function percentChange(now: number, before: number): number | null {
  if (before === 0) {
    return null;
  }
  return ((now - before) / before) * 100;
}

export type SiteRankingSort = "kwh" | "peakKw";

/** Ruling 4.6: a percent only when the site is in both lists and the previous kWh is above zero. */
export type SiteChange =
  | { kind: "none" }
  | { kind: "no_previous" }
  | { kind: "change"; pct: number | null };

export type SiteRankingRow = {
  site: EnergySiteEnergy;
  previous: EnergySiteEnergy | null;
  change: SiteChange;
};

/** The ranking rows, sorted by the chosen figure (largest first; ties by name). */
export function rankingRows(
  current: readonly EnergySiteEnergy[],
  compare: readonly EnergySiteEnergy[] | null,
  sort: SiteRankingSort,
): SiteRankingRow[] {
  const previousById = new Map((compare ?? []).map((s) => [s.locationId, s]));
  const rows = current.map((site): SiteRankingRow => {
    if (compare === null) {
      return { site, previous: null, change: { kind: "none" } };
    }
    const previous = previousById.get(site.locationId) ?? null;
    if (previous === null) {
      return { site, previous, change: { kind: "no_previous" } };
    }
    return { site, previous, change: { kind: "change", pct: percentChange(site.kwh, previous.kwh) } };
  });
  return rows.sort((a, b) => b.site[sort] - a.site[sort] || a.site.name.localeCompare(b.site.name));
}

export type HeatmapGrid = {
  /** Local dates, ascending. */
  days: string[];
  /** 0 to 23. */
  hours: number[];
  /** `values[dayIndex][hour]`; `null` is a cell with no data. */
  values: (number | null)[][];
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function heatmapGrid(cells: readonly EnergyHeatmapCell[]): HeatmapGrid {
  const days = [...new Set(cells.map((c) => c.day))].sort();
  const index = new Map(days.map((day, i) => [day, i]));
  const values = days.map(() => HOURS.map((): number | null => null));
  for (const cell of cells) {
    values[index.get(cell.day) as number][cell.hour] = cell.kwh;
  }
  return { days, hours: [...HOURS], values };
}

/**
 * The colour scale's top: the nearest-rank 95th percentile of the cells (ascending
 * order, index `ceil(0.95 n) - 1`); a cell above it saturates. `0` with no cells.
 */
export function colourMax(cells: readonly EnergyHeatmapCell[]): number {
  if (cells.length === 0) {
    return 0;
  }
  const sorted = cells.map((c) => c.kwh).sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)];
}

export type AbnormalGroups = {
  above: EnergyAbnormalEntry[];
  notEnoughHistory: EnergyAbnormalEntry[];
  normalCount: { sites: number; assets: number };
  truncated: boolean;
};

export function abnormalGroups(abnormal: EnergyOrganizationViews["abnormal"]): AbnormalGroups {
  return {
    above: abnormal.entries.filter((e) => e.verdict === "above"),
    notEnoughHistory: abnormal.entries.filter((e) => e.verdict === "not_enough_history"),
    normalCount: abnormal.normalCount,
    truncated: abnormal.truncated,
  };
}

/** The one sentence that says what "abnormal" means for this view. */
export function baselineSentence(baseline: EnergyOrganizationViews["abnormal"]["baseline"]): string {
  const percent = Math.round((baseline.ratio - 1) * 100);
  const head = `≥ ${percent} % above the median of the same window`;
  if (baseline.windowsConsulted < baseline.windows) {
    return `${head}; only ${baseline.windowsConsulted} of ${baseline.windows} windows is within the retained history at this detail level`;
  }
  if (baseline.stepDays === 1) {
    return `${head} on the ${baseline.windows} preceding days`;
  }
  return `${head} in the ${baseline.windows} preceding ${baseline.stepDays}-day windows`;
}

/** One stack per trend column, in the server's order; the folded remainder is "Other sites". */
export function siteStacks(trend: EnergySiteTrend, roles: Roles): EnergyStack[] {
  const palette = seriesPalette(roles);
  return trend.columns.map((column, i) => ({
    name: column.kind === "site" ? column.name : "Other sites",
    colour: column.kind === "site" ? palette[i % palette.length] : roles["ink-faint"],
    data: trend.points.map((p): [string, number] => [p.t, p.kw[i] ?? 0]),
  }));
}
