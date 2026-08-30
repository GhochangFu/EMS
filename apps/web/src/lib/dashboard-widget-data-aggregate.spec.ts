import { encodePointRef } from "@bms/shared";
import type { DashboardDto, DashboardWidgetDto, DashboardWidgetPointDto } from "@bms/shared";

import {
  aggregateKeyFor,
  aggregateRequestsFor,
  widgetDataFor,
  type LatestByRef,
} from "./dashboard-widget-data";
import { FRESH_MS } from "./schematic-telemetry";

/**
 * `F3.35` Stage A — the second data path (ADR 0048 decision 3).
 *
 * Its own file rather than more of `dashboard-widget-data.spec.ts`: these
 * assertions are about a branch that did not exist before this row, and the
 * fixtures they need (an aggregate response, a bucket array) are not the two
 * maps every other assertion in that file uses. `dashboard-widget-data.test.ts`
 * keeps the original wrapper; `dashboard-widget-data-aggregate.test.ts` is this
 * file's (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NOW = Date.parse("2026-01-01T00:10:00.000Z");
const FRESH_TIME = new Date(NOW - 1_000).toISOString();
const STALE_TIME = new Date(NOW - (FRESH_MS + 1_000)).toISOString();

const IDENTITY = {
  id: "11111111-1111-4111-8111-111111111111",
  dashboardId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  title: null,
  gridX: 0,
  gridY: 0,
  gridW: 4,
  gridH: 4,
  // `F3.35` Stage C — the second binding array. Empty here: these fixtures
  // exercise Stage A's aggregation, which is a point-bound path.
  sources: [],
};

const ASSET = "66666666-6666-4666-8666-666666666666";
const REF = encodePointRef(ASSET, "power_kw");

const POINT: DashboardWidgetPointDto = {
  id: "44444444-4444-4444-8444-444444444444",
  pointId: "55555555-5555-4555-8555-555555555555",
  role: "primary",
  sortOrder: 0,
  assetId: ASSET,
  pointKey: "power_kw",
  unit: "kW",
};

const STATS = { sum: 100, average: 12.1, min: 0, max: 18.4, peakAt: FRESH_TIME, sampleCount: 60 };

/** Bucket starts one minute apart, the newest `agoMs` before `NOW`. */
function buckets(count: number, agoMs: number): { t: string; v: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    t: new Date(NOW - agoMs - (count - 1 - i) * 60_000).toISOString(),
    v: 10 + i,
  }));
}

function answer(overrides: Record<string, unknown> = {}) {
  return {
    pointRef: REF,
    from: FRESH_TIME,
    to: FRESH_TIME,
    bucketSeconds: 60,
    stats: STATS,
    compare: null,
    buckets: null,
    ...overrides,
  } as never;
}

function aggregatedChart(config: Record<string, unknown> = {}): DashboardWidgetDto {
  return {
    ...IDENTITY,
    widgetType: "chart",
    config: { series: "line", aggregate: "avg", windowMinutes: 60, footerStats: true, ...config },
    points: [POINT],
  } as DashboardWidgetDto;
}

function rawChart(): DashboardWidgetDto {
  return { ...IDENTITY, widgetType: "chart", config: { series: "line" }, points: [POINT] };
}

function aggregatedTile(config: Record<string, unknown> = {}): DashboardWidgetDto {
  return {
    ...IDENTITY,
    widgetType: "value_tile",
    config: { unit: "kWh", aggregate: "sum", windowMinutes: 1_440, ...config },
    points: [POINT],
  } as DashboardWidgetDto;
}

function rawTile(): DashboardWidgetDto {
  return { ...IDENTITY, widgetType: "value_tile", config: { unit: "kW" }, points: [POINT] };
}

const chartKey = (windowMinutes = 60) =>
  aggregateKeyFor({ ref: REF, windowMinutes, compare: false, bucketFunction: "avg" });

const tileKey = (windowMinutes = 1_440, compare = false) =>
  aggregateKeyFor({ ref: REF, windowMinutes, compare, bucketFunction: undefined });

/**
 * **The defect this unit exists to prevent, asserted before it could ship.**
 *
 * A bucketed series' newest `t` is a **bucket start** — at the finest rung up to
 * 60 seconds old before a single sample is missing — and `FRESH_MS` is 25,000.
 * Aging a bucketed chart through `freshestSeriesMs`, the way the raw path
 * correctly does, would mark **every** bucketed chart stale by arithmetic, at
 * every rung, with live data flowing, and `WidgetFrame` would draw its "Offline"
 * badge over a chart working perfectly.
 *
 * A bucketed chart is therefore aged by its bound point's latest **reading**,
 * which carries a real sample time. The second assertion is what stops the fix
 * from becoming "bucketed charts are never stale".
 */
export function runBucketedChartStalenessTests(): void {
  const rows = answer({ buckets: buckets(3, 55_000) });

  const live = widgetDataFor(
    aggregatedChart(),
    new Map([[REF, { value: 7, time: new Date(NOW - 5_000).toISOString() }]]),
    new Map(),
    NOW,
    new Map([[chartKey(), rows]]),
  );
  assert(
    live.status === "ready" && live.stale === false,
    "a bucketed chart whose point reported 5 s ago must not read as stale because its newest " +
      "BUCKET START is 55 s old — that is the Offline badge over a working chart",
  );

  const dead = widgetDataFor(
    aggregatedChart(),
    new Map([[REF, { value: 7, time: STALE_TIME }]]),
    new Map(),
    NOW,
    new Map([[chartKey(), rows]]),
  );
  assert(
    dead.status === "ready" && dead.stale === true,
    "a bucketed chart whose point stopped reporting must still go stale — the fix must not be " +
      "'bucketed charts are never stale'",
  );
}

/**
 * **A chart that shows the footer but plots RAW readings still ages by its
 * series** (code review — this combination had no assertion).
 *
 * `config.aggregate` alone selects the reading-based clock, and `footerStats`
 * alone must not. It is a real combination: `aggregateRequestsFor` issues a
 * request for it, because the footer's Peak and Average are the scalar half of
 * the same response, and its series is still raw history whose `t` is a real
 * sample time.
 */
export function runFooterOnlyChartAgesByItsSeriesTests(): void {
  const footerOnly = { ...aggregatedChart({ aggregate: undefined }) };

  const fresh = widgetDataFor(
    footerOnly,
    // `latestByRef` is deliberately EMPTY. Reading it here would make this chart
    // stale, so a branch that wrongly took the reading-based clock fails.
    new Map(),
    new Map([[REF, [{ t: FRESH_TIME, v: 12 }]]]),
    NOW,
    new Map([[tileKey(60), answer()]]),
  );
  assert(
    fresh.status === "ready" && fresh.stale === false,
    "a footer-only chart must age by its own raw series, not by latestByRef",
  );

  const stale = widgetDataFor(
    footerOnly,
    new Map([[REF, { value: 7, time: FRESH_TIME }]]),
    new Map([[REF, [{ t: STALE_TIME, v: 12 }]]]),
    NOW,
    new Map([[tileKey(60), answer()]]),
  );
  assert(
    stale.status === "ready" && stale.stale === true,
    "and it must go stale on an old series even while a reading is fresh",
  );
}

/**
 * The bucketed branch plots the endpoint's buckets; the raw branch is untouched.
 *
 * The history map is deliberately populated with a **different** value, so
 * reading the wrong map fails loudly rather than coincidentally agreeing. The
 * last assertion is the regression direction: every chart saved before `F3.35`
 * carries no `aggregate` and must keep reading `historyByRef` exactly as it did.
 */
export function runBucketedChartSeriesTests(): void {
  const bucketed = widgetDataFor(
    aggregatedChart(),
    new Map(),
    new Map([[REF, [{ t: FRESH_TIME, v: 999 }]]]),
    NOW,
    new Map([[chartKey(), answer({ buckets: buckets(3, 0) })]]),
  );
  assert(
    bucketed.status === "ready" && bucketed.series[0]?.points.length === 3,
    "a chart with an aggregate must plot the endpoint's buckets",
  );
  assert(
    bucketed.status === "ready" && bucketed.series[0]?.points[0]?.v === 10,
    "the plotted values must be the buckets', not the history's",
  );
  assert(
    bucketed.status === "ready" && bucketed.stats?.average === 12.1 && bucketed.bucketSeconds === 60,
    "the footer's statistics and the bucket width must ride along on the same response",
  );

  const raw = widgetDataFor(rawChart(), new Map(), new Map([[REF, [{ t: FRESH_TIME, v: 999 }]]]), NOW);
  assert(
    raw.status === "ready" && raw.series[0]?.points[0]?.v === 999,
    "a chart with NO aggregate must still read historyByRef — the regression direction",
  );
}

/**
 * An aggregate asked for and not answered yet leaves the widget **readable**.
 *
 * ADR 0047 Amendment 1 draws that line: zero bindings is `"empty"`, a
 * bound-but-unread point stays `"ready"`. A loading aggregate is the second
 * case, and rendering it as the first would flash "No data bound." on every
 * page load.
 */
export function runUnresolvedAggregateStaysReadableTests(): void {
  const tile = widgetDataFor(aggregatedTile(), new Map(), new Map(), NOW, new Map());
  assert(
    tile.status === "ready" && tile.primary === null,
    "a tile whose aggregate has not resolved stays ready with a null primary",
  );

  const chart = widgetDataFor(aggregatedChart(), new Map(), new Map(), NOW, new Map());
  assert(
    chart.status === "ready" && chart.series[0]?.points.length === 0,
    "a chart whose aggregate has not resolved stays ready with an empty series",
  );
}

/**
 * The tile reads **one** statistic of the four, and `avg` reads `average`.
 *
 * The `avg` case is the one worth asserting: the response spells the mean out
 * rather than naming a field `avg`, because it is a division the database
 * performed and not a column. Indexing by the raw function name would be
 * `undefined`, and the tile would show an em dash with the data present.
 */
export function runTileReadsItsOwnStatisticTests(): void {
  for (const [fn, expected] of [
    ["sum", 100],
    ["avg", 12.1],
    ["min", 0],
    ["max", 18.4],
  ] as const) {
    const data = widgetDataFor(
      aggregatedTile({ aggregate: fn }),
      new Map([[REF, { value: 7, time: FRESH_TIME }]]),
      new Map(),
      NOW,
      new Map([[tileKey(), answer()]]),
    );
    assert(
      data.status === "ready" && data.primary === expected,
      `a tile with aggregate "${fn}" must show ${expected}`,
    );
  }

  const raw = widgetDataFor(
    rawTile(),
    new Map([[REF, { value: 7, time: FRESH_TIME }]]),
    new Map(),
    NOW,
    new Map(),
  );
  assert(
    raw.status === "ready" && raw.primary === 7,
    "a tile with NO aggregate must still show the latest reading — the regression direction",
  );
}

/**
 * The compare window's number reaches the tile, and its absence is `null`.
 *
 * A zero baseline and a missing baseline both end as "no delta" downstream, but
 * they must arrive here distinctly: `formatDelta(x, 0)` returning `null` is a
 * separate guard, and folding them together in this function would hide which
 * one fired.
 */
export function runTileCompareValueTests(): void {
  const latest: LatestByRef = new Map([[REF, { value: 7, time: FRESH_TIME }]]);

  const withCompare = widgetDataFor(
    aggregatedTile({ compareToPrevious: true }),
    latest,
    new Map(),
    NOW,
    new Map([
      [
        tileKey(1_440, true),
        answer({ compare: { from: FRESH_TIME, to: FRESH_TIME, stats: { ...STATS, sum: 121 } } }),
      ],
    ]),
  );
  assert(
    withCompare.status === "ready" && withCompare.compareValue === 121,
    "the preceding window's number must reach the tile",
  );

  const without = widgetDataFor(aggregatedTile(), latest, new Map(), NOW, new Map());
  assert(
    without.status === "ready" && (without.compareValue ?? null) === null,
    "a tile that asked for no compare must carry no compare value",
  );
}

/**
 * **The request list, and why it is keyed by the request rather than the widget.**
 *
 * Two widgets asking the same point the same question are ONE read. Two asking
 * the same point for DIFFERENT windows are two — a widget-keyed map would have
 * collapsed them and shown one of them the other's window.
 *
 * And a dashboard using no aggregation asks for nothing at all, which is every
 * dashboard saved before `F3.35`.
 */
export function runAggregateRequestListTests(): void {
  const dashboard = (widgets: DashboardWidgetDto[]): DashboardDto => ({
    id: "id",
    organizationId: "org",
    slug: "s",
    name: "n",
    description: null,
    locationId: null,
    assetGroupId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    widgets,
  });

  assert(
    aggregateRequestsFor(dashboard([rawTile(), rawChart()])).length === 0,
    "a dashboard using no aggregation must issue no aggregate reads at all",
  );

  const shared = aggregateRequestsFor(dashboard([aggregatedTile(), aggregatedTile()]));
  assert(
    shared.length === 1,
    `two tiles asking the same point the same question are one read, got ${shared.length}`,
  );

  const different = aggregateRequestsFor(
    dashboard([aggregatedTile(), aggregatedTile({ windowMinutes: 60 })]),
  );
  assert(
    different.length === 2,
    `two tiles asking the same point for different windows are two reads, got ${different.length}`,
  );

  const tileRequest = aggregateRequestsFor(dashboard([aggregatedTile()]))[0];
  assert(
    tileRequest?.bucketFunction === undefined,
    "a tile must never ask for buckets — it reads one number and would pay for up to 2,880 rows",
  );

  const chartRequest = aggregateRequestsFor(dashboard([aggregatedChart()]))[0];
  assert(
    chartRequest?.bucketFunction === "avg" && chartRequest.compare === false,
    "a chart asks for buckets and never for a compare — nothing overlays yesterday in Stage A",
  );

  const footerOnly = aggregateRequestsFor(
    dashboard([
      {
        ...IDENTITY,
        widgetType: "chart",
        config: { series: "line", footerStats: true },
        points: [POINT],
      },
    ]),
  );
  assert(
    footerOnly.length === 1 && footerOnly[0]?.bucketFunction === undefined,
    "a chart showing only the footer still needs the scalar half, and asks for no buckets",
  );
}
