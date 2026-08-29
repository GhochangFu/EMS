import { encodePointRef } from "@bms/shared";
import type { DashboardDto, DashboardWidgetDto, DashboardWidgetPointDto } from "@bms/shared";

import { isStale, readingTimestampMs } from "./schematic-telemetry";
import type { WidgetSeries, WidgetSeriesPoint } from "./widget-catalog";
import type { WidgetData } from "../components/widgets/dashboard-widget";

/**
 * Maps `F3.1b`'s response onto `WidgetData` — the seam `dashboard-widget.tsx`'s
 * own docblock names as `F3.1d`'s to build. Both functions are pure: the
 * caller (`F3.1d` Unit 6's `use-dashboard-telemetry.ts`) resolves the REST
 * seed and the live socket into the two maps below; nothing here fetches or
 * subscribes to anything, which is what makes it testable without a socket
 * or a running API.
 */

/** One point's latest reading, carrying `time` beside `value` — review finding (HIGH): a
 * value with no timestamp cannot be aged, so nothing downstream could tell a dead sensor's
 * frozen last reading from a live one. `time` is the same ISO string shape `TelemetryReading`
 * carries, read through `readingTimestampMs`/`isStale` (`schematic-telemetry.ts`) — the SAME
 * gate and the SAME `FRESH_MS` window the seven control-room pages already use, not a second
 * one invented here. */
export type LatestReading = { readonly value: number; readonly time: string };

/** A point's latest reading, keyed by `encodePointRef(assetId, pointKey)`. `null` is a point
 * that has never reported, not a missing entry — a genuinely absent ref (never resolved,
 * still loading) is also read as `null` here, and the caller decides whether that distinction
 * needs a "loading" status of its own; this mapper always answers `"ready"` once a widget has
 * at least one binding, per ADR 0047 Amendment 1 (see `widgetDataFor`). */
export type LatestByRef = ReadonlyMap<string, LatestReading | null>;

/** One bound point's recent history, keyed the same way. An absent ref reads as no samples,
 * not an error — the same "no data yet" reading `LatestByRef` gives a fresh binding. */
export type HistoryByRef = ReadonlyMap<string, readonly WidgetSeriesPoint[]>;

/** Every distinct point a dashboard's widgets bind, as the `pointRef` route param
 * `GET /telemetry/points/:pointRef/recent` and the `/ws/telemetry` socket both key on.
 * Distinct because two widgets — or two roles on one widget — may bind the same point, and
 * `use-dashboard-telemetry.ts` must not open one REST read or one socket subscription per
 * *binding* when it only needs one per *point*. */
export function pointRefsFor(dashboard: DashboardDto): string[] {
  const refs = new Set<string>();
  for (const widget of dashboard.widgets) {
    for (const point of widget.points) {
      refs.add(encodePointRef(point.assetId, point.pointKey));
    }
  }
  return [...refs];
}

/** The point a single-value widget (`radial_gauge`/`tank_level`/`value_tile`) reads its
 * `primary` from. Cardinality caps these three types at exactly one binding
 * (`WIDGET_POINT_CARDINALITY`), so `points[0]` very nearly always is it — but this prefers a
 * `"primary"`-role point when more than one is present, rather than assuming array order, so a
 * malformed or historical row with a stray `"series"`-role binding cannot silently become the
 * one that renders. */
function primaryPoint(points: readonly DashboardWidgetPointDto[]): DashboardWidgetPointDto | undefined {
  return points.find((point) => point.role === "primary") ?? points[0];
}

/**
 * The freshest sample's age, across every series a `chart` widget draws — `null` when there
 * is none. `WidgetSeriesPoint.t` is the same ISO shape a `LatestReading.time` carries, so this
 * reuses `readingTimestampMs` rather than parsing dates a second way.
 */
function freshestSeriesMs(series: readonly WidgetSeries[], nowMs: number): number | null {
  let latest: number | null = null;
  for (const one of series) {
    const last = one.points[one.points.length - 1];
    if (!last) {
      continue;
    }
    const ms = readingTimestampMs(last.t, nowMs);
    if (ms !== null && (latest === null || ms > latest)) {
      latest = ms;
    }
  }
  return latest;
}

/**
 * Maps one widget's bindings and the two resolved data maps onto what
 * `DashboardWidget` renders.
 *
 * **Zero bindings is the non-ready `"empty"` branch, never `"ready"` with a
 * `null` primary.** `dashboard_widget_points.point_id` is `ON DELETE CASCADE`,
 * so a retired sensor can legitimately take a live gauge to zero bindings —
 * ADR 0047 Amendment 1 and `contracts/dashboard-builder.ts:232-236` both rule
 * that state stays readable and renders as `"No data bound."`
 * (`widget-frame.tsx`'s `"empty"` arm), which only happens if this function
 * hands `WidgetFrame` that status rather than a `"ready"` one with nothing to
 * show.
 *
 * A **bound-but-not-yet-read** point is different and stays `"ready"` with
 * `primary: null` — `radial-gauge-widget.tsx`'s own docblock is the renderer
 * side of that distinction (a `null` primary pins the needle at `config.min`
 * instead of feeding ECharts a `NaN`).
 *
 * **`stale` (review finding, HIGH) is the ADR 0027 gate, reaching a dashboard widget for the
 * first time.** Before this, `latestByRef` carried a bare value with no timestamp, so a dead
 * sensor's last reading rendered exactly like a live one — and nothing forced a re-render while
 * the socket stayed silent, which is the signal an outage removes. `nowMs` is an ARGUMENT, never
 * read from the clock inside this pure function (the `widget-echarts-option.ts` rule), so the
 * caller controls it and a test can pin it. No reading at all (`null`) reads as stale too —
 * `isStale(null, nowMs)` already says so — because "never contacted" is no better evidence of
 * life than "contacted long ago".
 */
export function widgetDataFor(
  widget: DashboardWidgetDto,
  latestByRef: LatestByRef,
  historyByRef: HistoryByRef,
  nowMs: number,
): WidgetData {
  if (widget.points.length === 0) {
    return { status: "empty" };
  }

  if (widget.widgetType === "chart") {
    // Ordered by the STORED `sortOrder`, not by array position — `dashboard_widget_points`
    // carries no guaranteed row order, and the legend's colour assignment (`WidgetSeries`'s own
    // docblock) depends on this order staying stable between reads.
    const series: WidgetSeries[] = [...widget.points]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((point) => ({
        // `pointKey` is the only human-readable field this DTO carries — `adminAssetPointDtoSchema`
        // has no asset name and `dashboardWidgetPointDtoSchema` has no label column of its own.
        // A nicer legend (an asset-qualified name) needs a second round trip per point, which
        // plan §15 Q4 already declined for the whole row; do not "fix" this into a fetch.
        name: point.pointKey,
        sortOrder: point.sortOrder,
        points: historyByRef.get(encodePointRef(point.assetId, point.pointKey)) ?? [],
      }));
    return { status: "ready", primary: null, series, stale: isStale(freshestSeriesMs(series, nowMs), nowMs) };
  }

  const point = primaryPoint(widget.points);
  const reading = point ? (latestByRef.get(encodePointRef(point.assetId, point.pointKey)) ?? null) : null;
  const primary = reading ? reading.value : null;
  const lastSeenMs = reading ? readingTimestampMs(reading.time, nowMs) : null;
  return { status: "ready", primary, series: [], stale: isStale(lastSeenMs, nowMs) };
}
