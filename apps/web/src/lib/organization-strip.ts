import type { MetricCatalogValueDto, OrganizationStripSourceDto, OrganizationStripTileDto } from "@bms/shared";

import { toKpiTileProps, type KpiTileWidgetProps } from "./widget-value";

/**
 * `F4.317` task 5.2 (ADR 0112 decisions 5 to 8) — the organization strip's tile rules, pure.
 * The component draws; every decision about what a tile says lives here and is tested here.
 *
 * - **The primary** is the source with the lowest `sortOrder` (sortOrder 0 on a stock tile).
 * - **The prior** is the primary's `prior.value`; `toKpiTileProps` shows "vs yesterday" only for a
 *   tile whose config asks `compareToPrevious`, and the API computes a prior only for one (ruling
 *   Q5), so a tile that does not ask never has one to show.
 * - **Tile 3's critical note** (ruling Q1b) is read from its `alarms.critical.count` source with
 *   the estate rule: "N critical" and a critical tone when N > 0; else a warning tone when any
 *   alarm is open; else none.
 * - **`sites.live.count`** reads `live / total`: the value is the live count and the resolve's
 *   `coverage.carrying` is the location total. Without a coverage it is the bare count.
 * - **Stale** is the whole read's age, not a per-tile reading: a refetch that fails keeps the last
 *   answer on screen, and the ring says it is old. The caller passes the time the browser received
 *   the answer (not the server's `resolvedAt`), so a skewed browser clock cannot stale every tile.
 * - **A value that is not there is "—" with a reason** (`Not available`: the binding did not
 *   resolve; `No data`: it resolved to null), never a fabricated zero.
 */

/** A read older than this is stale. The strip re-reads every `STRIP_REFETCH_MS`; three misses. */
export const STRIP_REFETCH_MS = 8000;
export const STRIP_STALE_MS = STRIP_REFETCH_MS * 3 + 1000;

const SITES_LIVE_KEY = "sites.live.count";
const CRITICAL_KEY = "alarms.critical.count";
const OPEN_ALARMS_KEY = "alarms.active.count";

export type StripTileProps = KpiTileWidgetProps & { readonly stale: boolean };

type MetricValue = Extract<MetricCatalogValueDto, { shape: "metric" }>;

/** The resolved metric of a source, or null when it did not resolve or is not a scalar. */
function metricOf(source: OrganizationStripSourceDto | undefined): MetricValue | null {
  return source?.resolved?.shape === "metric" ? source.resolved : null;
}

/** The sources of a tile in `sortOrder` (a copy: the DTO is not reordered). */
export function sourcesInOrder(tile: OrganizationStripTileDto): OrganizationStripSourceDto[] {
  return [...tile.sources].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The props one tile of the strip draws with, at `nowMs`, for a read received at `resolvedAt` (an ISO time on the same clock as `nowMs`). */
export function stripTileProps(tile: OrganizationStripTileDto, resolvedAt: string, nowMs: number): StripTileProps {
  const sources = sourcesInOrder(tile);
  const primarySource = sources[0];
  const primary = metricOf(primarySource);
  const title = tile.title ?? "";

  if (primary === null || primary.value === null) {
    const base = toKpiTileProps({ title, status: "empty", primary: null, config: tile.config });
    return { ...base, hint: primary === null ? "Not available" : "No data", stale: false };
  }

  const critical = metricOf(sources.find((s) => s.catalogKey === CRITICAL_KEY));
  const isAlarmTile = primarySource?.catalogKey === OPEN_ALARMS_KEY;
  const criticalCount = critical?.value ?? 0;
  const tone = isAlarmTile
    ? criticalCount > 0
      ? "critical"
      : primary.value > 0
        ? "warning"
        : "ok"
    : undefined;

  const base = toKpiTileProps({
    title,
    status: "ready",
    primary: primary.value,
    config: tile.config,
    tone,
    compareValue: primary.prior?.value ?? null,
    coverage: primary.coverage ?? null,
    currency: primary.currency ?? null,
    catalogKey: primary.key,
  });

  const stale = nowMs - Date.parse(resolvedAt) > STRIP_STALE_MS;
  const note =
    isAlarmTile && criticalCount > 0 ? `${criticalCount} critical` : base.note;
  if (primary.key === SITES_LIVE_KEY) {
    const total = primary.coverage?.carrying;
    return {
      ...base,
      value: total === undefined ? base.value : `${primary.value} / ${total}`,
      note: undefined,
      stale,
    };
  }
  return { ...base, note, stale };
}
