import { encodePointRef } from "@bms/shared";
import type {
  DashboardDto,
  DashboardWidgetDto,
  DashboardWidgetPointDto,
  PointAggregateFunction,
  PointAggregateResponse,
  PointAggregateStats,
} from "@bms/shared";

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

// --- `F3.35` Stage A — the second data path (ADR 0048 decision 3) -----------

/**
 * The window a widget aggregates over when its config names none — one day,
 * which is what the mock's *Today* cards show. It matches the endpoint's own
 * default, so a request built here and a request built by hand agree.
 */
export const DEFAULT_AGGREGATE_WINDOW_MINUTES = 1_440;

/** One aggregate read a dashboard needs, as `use-dashboard-telemetry.ts` issues it. */
export type AggregateRequest = {
  readonly key: string;
  readonly ref: string;
  readonly windowMinutes: number;
  readonly compare: boolean;
  readonly bucketFunction?: PointAggregateFunction;
};

/** Aggregate responses keyed by {@link aggregateKeyFor}. `null` is "asked for, not answered yet". */
export type AggregateByKey = ReadonlyMap<string, PointAggregateResponse | null>;

/**
 * The identity of one aggregate read.
 *
 * **Keyed by the request, not by the widget.** Two widgets asking the same point
 * for the same window and function are one read, deduplicated here and again by
 * TanStack Query — the same reason `pointRefsFor` returns distinct refs rather
 * than one entry per binding. Two widgets asking the *same* point for
 * *different* windows are genuinely two reads, and a widget-keyed map would have
 * made them one and shown the wrong window on one of them.
 */
export function aggregateKeyFor(request: Omit<AggregateRequest, "key">): string {
  return `${request.ref}|${request.windowMinutes}|${request.compare}|${request.bucketFunction ?? ""}`;
}

const withKey = (request: Omit<AggregateRequest, "key">): AggregateRequest => ({
  ...request,
  key: aggregateKeyFor(request),
});

/**
 * Every aggregate read a dashboard's widgets need — none, for a dashboard that
 * uses no aggregation, which is every dashboard saved before `F3.35`.
 *
 * A `value_tile` asks only when `config.aggregate` is set; a `chart` asks when
 * it plots buckets **or** when it shows the footer, because the footer's Peak
 * and Average are the scalar half of the same response.
 */
export function aggregateRequestsFor(dashboard: DashboardDto): AggregateRequest[] {
  const byKey = new Map<string, AggregateRequest>();
  for (const widget of dashboard.widgets) {
    for (const request of aggregateRequestsForWidget(widget)) {
      byKey.set(request.key, request);
    }
  }
  return [...byKey.values()];
}

function aggregateRequestsForWidget(widget: DashboardWidgetDto): AggregateRequest[] {
  if (widget.widgetType === "value_tile") {
    if (!widget.config.aggregate) {
      return [];
    }
    const point = primaryPoint(widget.points);
    if (!point) {
      return [];
    }
    return [
      withKey({
        ref: encodePointRef(point.assetId, point.pointKey),
        windowMinutes: widget.config.windowMinutes ?? DEFAULT_AGGREGATE_WINDOW_MINUTES,
        compare: widget.config.compareToPrevious === true,
        // A tile reads one number out of `stats`, which the endpoint returns for
        // all four functions unconditionally. Asking for buckets it will not
        // plot would cost up to 2,880 rows per tile.
        bucketFunction: undefined,
      }),
    ];
  }

  if (widget.widgetType === "chart") {
    if (!widget.config.aggregate && !widget.config.footerStats) {
      return [];
    }
    const windowMinutes = widget.config.windowMinutes ?? DEFAULT_AGGREGATE_WINDOW_MINUTES;
    return [...widget.points]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((point) =>
        withKey({
          ref: encodePointRef(point.assetId, point.pointKey),
          windowMinutes,
          compare: false, // Nothing overlays yesterday behind today in Stage A.
          bucketFunction: widget.config.aggregate,
        }),
      );
  }

  return [];
}

/**
 * The one statistic a tile shows, out of the four the endpoint always returns.
 *
 * `avg` reads `average` rather than a field named `avg`: the response contract
 * spells the mean out, because `avg` beside `sum`/`min`/`max` reads like a
 * column and this one is a division the database performed.
 */
function statFor(stats: PointAggregateStats, fn: PointAggregateFunction): number | null {
  return fn === "avg" ? stats.average : stats[fn];
}

/**
 * The newest **real sample** across a widget's bound points.
 *
 * **This, not the newest series point, is what ages a bucketed chart.** A
 * bucketed series' last `t` is a *bucket start*, which at the finest rung is up
 * to 60 seconds old before a single sample is missing — and `FRESH_MS` is
 * 25,000. Aging a bucketed chart by its series would mark every one of them
 * stale by arithmetic, at every rung, with live data flowing, and `WidgetFrame`
 * would draw its "Offline" badge over a chart that is working perfectly.
 */
function freshestReadingMs(
  points: readonly DashboardWidgetPointDto[],
  latestByRef: LatestByRef,
  nowMs: number,
): number | null {
  let latest: number | null = null;
  for (const point of points) {
    const reading = latestByRef.get(encodePointRef(point.assetId, point.pointKey));
    if (!reading) {
      continue;
    }
    const ms = readingTimestampMs(reading.time, nowMs);
    if (ms !== null && (latest === null || ms > latest)) {
      latest = ms;
    }
  }
  return latest;
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
  aggregateByKey?: AggregateByKey,
): WidgetData {
  if (widget.points.length === 0) {
    return { status: "empty" };
  }

  if (widget.widgetType === "chart") {
    const config = widget.config;
    const windowMinutes = config.windowMinutes ?? DEFAULT_AGGREGATE_WINDOW_MINUTES;
    // Ordered by the STORED `sortOrder`, not by array position — `dashboard_widget_points`
    // carries no guaranteed row order, and the legend's colour assignment (`WidgetSeries`'s own
    // docblock) depends on this order staying stable between reads.
    const ordered = [...widget.points].sort((a, b) => a.sortOrder - b.sortOrder);
    const aggregateFor = (point: DashboardWidgetPointDto): PointAggregateResponse | null =>
      aggregateByKey?.get(
        aggregateKeyFor({
          ref: encodePointRef(point.assetId, point.pointKey),
          windowMinutes,
          compare: false,
          bucketFunction: config.aggregate,
        }),
      ) ?? null;

    const series: WidgetSeries[] = ordered.map((point) => ({
      // `pointKey` is the only human-readable field this DTO carries — `adminAssetPointDtoSchema`
      // has no asset name and `dashboardWidgetPointDtoSchema` has no label column of its own.
      // A nicer legend (an asset-qualified name) needs a second round trip per point, which
      // plan §15 Q4 already declined for the whole row; do not "fix" this into a fetch.
      name: point.pointKey,
      sortOrder: point.sortOrder,
      points: config.aggregate
        ? (aggregateFor(point)?.buckets ?? [])
        : (historyByRef.get(encodePointRef(point.assetId, point.pointKey)) ?? []),
    }));

    // The footer describes the FIRST series, and says so in the renderer. A
    // multi-series chart has one footer and several plots, so one of them has to
    // be the one described; the first is the one whose colour the legend leads
    // with. `bucketSeconds` rides along because the granularity cell reads it.
    const lead = ordered[0] ? aggregateFor(ordered[0]) : null;

    return {
      status: "ready",
      primary: null,
      series,
      // **The bucketed branch ages by the point's real samples, never by the
      // series.** A bucket's `t` is a bucket START — up to 60 s old at the
      // finest rung before anything is wrong — and `FRESH_MS` is 25,000, so
      // reading it through `freshestSeriesMs` would mark every bucketed chart
      // "Offline" by arithmetic while live data flowed. The raw branch keeps
      // `freshestSeriesMs`, where `t` genuinely is a sample time.
      stale: config.aggregate
        ? isStale(freshestReadingMs(ordered, latestByRef, nowMs), nowMs)
        : isStale(freshestSeriesMs(series, nowMs), nowMs),
      stats: lead?.stats ?? null,
      bucketSeconds: lead?.bucketSeconds ?? null,
    };
  }

  const point = primaryPoint(widget.points);
  const reading = point ? (latestByRef.get(encodePointRef(point.assetId, point.pointKey)) ?? null) : null;
  const lastSeenMs = reading ? readingTimestampMs(reading.time, nowMs) : null;

  // A `value_tile` with an aggregate shows the window's number, not the latest
  // sample — but it is still aged by the latest sample, because "is this sensor
  // alive" is a question about readings and not about a total.
  if (widget.widgetType === "value_tile" && widget.config.aggregate && point) {
    const fn = widget.config.aggregate;
    const answer = aggregateByKey?.get(
      aggregateKeyFor({
        ref: encodePointRef(point.assetId, point.pointKey),
        windowMinutes: widget.config.windowMinutes ?? DEFAULT_AGGREGATE_WINDOW_MINUTES,
        compare: widget.config.compareToPrevious === true,
        bucketFunction: undefined,
      }),
    );
    return {
      status: "ready",
      primary: answer ? statFor(answer.stats, fn) : null,
      series: [],
      stale: isStale(lastSeenMs, nowMs),
      compareValue: answer?.compare ? statFor(answer.compare.stats, fn) : null,
    };
  }

  return { status: "ready", primary: reading ? reading.value : null, series: [], stale: isStale(lastSeenMs, nowMs) };
}
