import { encodePointRef } from "@bms/shared";
import type { DashboardDto, DashboardWidgetDto, DashboardWidgetPointDto } from "@bms/shared";

import { pointRefsFor, widgetDataFor, type HistoryByRef, type LatestByRef } from "./dashboard-widget-data";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const IDENTITY = {
  id: "11111111-1111-4111-8111-111111111111",
  dashboardId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  title: null,
  gridX: 0,
  gridY: 0,
  gridW: 4,
  gridH: 4,
};

function point(overrides: Partial<DashboardWidgetPointDto> = {}): DashboardWidgetPointDto {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    pointId: "55555555-5555-4555-8555-555555555555",
    role: "primary",
    sortOrder: 0,
    assetId: "66666666-6666-4666-8666-666666666666",
    pointKey: "power_kw",
    unit: "kW",
    ...overrides,
  };
}

function valueTileWidget(points: DashboardWidgetPointDto[]): DashboardWidgetDto {
  return { ...IDENTITY, widgetType: "value_tile", config: { unit: "kW", decimals: 1 }, points };
}

function chartWidget(points: DashboardWidgetPointDto[]): DashboardWidgetDto {
  return { ...IDENTITY, widgetType: "chart", config: { series: "line" }, points };
}

/** `pointRefsFor` — the distinct set of `encodePointRef` this dashboard needs data for. */
export function runPointRefsForTests(): void {
  const shared = point({ assetId: "asset-a", pointKey: "power_kw" });
  const distinct = point({ assetId: "asset-b", pointKey: "temp_c" });
  const dashboard: DashboardDto = {
    id: "id",
    organizationId: "org",
    slug: "s",
    name: "n",
    description: null,
    locationId: null,
    assetGroupId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    widgets: [
      valueTileWidget([shared]),
      // A second widget rebinding the SAME point must not double the ref count.
      valueTileWidget([point({ assetId: "asset-a", pointKey: "power_kw" })]),
      chartWidget([distinct]),
    ],
  };

  const refs = pointRefsFor(dashboard);
  assert(refs.length === 2, `two distinct points across three widgets must yield two refs — got ${refs.length}`);
  assert(
    refs.includes(encodePointRef("asset-a", "power_kw")) && refs.includes(encodePointRef("asset-b", "temp_c")),
    "both distinct point refs must be present",
  );

  const empty = pointRefsFor({ ...dashboard, widgets: [] });
  assert(empty.length === 0, "a dashboard with no widgets has no point refs");
}

/**
 * The load-bearing assertion (plan §9): zero bindings must render the non-ready `"empty"`
 * branch, never `"ready"` with a null primary — ADR 0047 Amendment 1's "no data bound"
 * obligation. Checked on `status` directly, not on `primary === null`, because a null primary
 * is ALSO the correct answer for a bound-but-unread point (the next test) — an assertion phrased
 * around `primary` would pass under the mutation this one exists to catch.
 */
export function runZeroBindingsTests(): void {
  for (const widget of [valueTileWidget([]), chartWidget([])]) {
    const data = widgetDataFor(widget, new Map(), new Map());
    assert(
      data.status === "empty",
      `a widget with zero point bindings must render the "no data bound" branch, got status="${data.status}"`,
    );
    assert(
      !("primary" in data),
      'the "empty" branch of WidgetData carries no primary field at all',
    );
  }
}

/** A single-value widget reads `primary` from its bound point's latest reading. */
export function runSingleValueWidgetTests(): void {
  const p = point({ assetId: "asset-a", pointKey: "power_kw" });
  const ref = encodePointRef("asset-a", "power_kw");

  const withReading: LatestByRef = new Map([[ref, 42]]);
  const ready = widgetDataFor(valueTileWidget([p]), withReading, new Map());
  assert(ready.status === "ready", "a bound point makes the widget ready");
  assert(ready.status === "ready" && ready.primary === 42, "primary is the resolved latest reading");
  assert(ready.status === "ready" && ready.series.length === 0, "a non-chart widget carries no series");

  // Bound but not yet read — distinct from zero bindings, and also "ready".
  const notYetRead = widgetDataFor(valueTileWidget([p]), new Map(), new Map());
  assert(
    notYetRead.status === "ready" && notYetRead.primary === null,
    "a bound point absent from latestByRef is a live binding with no reading yet — ready, primary null",
  );

  // A stray non-primary-role point on a single-value widget still resolves, preferring the
  // primary-role binding over array order.
  const primaryRole = point({ assetId: "asset-a", pointKey: "power_kw", role: "primary" });
  const seriesRole = point({ assetId: "asset-b", pointKey: "other", role: "series" });
  const latest: LatestByRef = new Map([
    [encodePointRef("asset-a", "power_kw"), 10],
    [encodePointRef("asset-b", "other"), 999],
  ]);
  const preferred = widgetDataFor(valueTileWidget([seriesRole, primaryRole]), latest, new Map());
  assert(
    preferred.status === "ready" && preferred.primary === 10,
    "the primary-role binding is preferred over array order",
  );
}

/**
 * The load-bearing assertion (plan §9): a chart's series are ordered by the stored `sortOrder`,
 * not by array position.
 */
export function runChartSeriesOrderingTests(): void {
  const first = point({ assetId: "asset-a", pointKey: "first", sortOrder: 0, role: "series" });
  const second = point({ assetId: "asset-b", pointKey: "second", sortOrder: 1, role: "series" });
  // Array position is DELIBERATELY reversed relative to sortOrder.
  const widget = chartWidget([second, first]);

  const history: HistoryByRef = new Map([
    [encodePointRef("asset-a", "first"), [{ t: "2026-01-01T00:00:00Z", v: 1 }]],
    [encodePointRef("asset-b", "second"), [{ t: "2026-01-01T00:00:00Z", v: 2 }]],
  ]);

  const data = widgetDataFor(widget, new Map(), history);
  assert(data.status === "ready", "a chart with bindings is ready");
  if (data.status !== "ready") return;

  assert(
    data.series.length === 2,
    `both bound points must produce a series entry — got ${data.series.length}`,
  );
  assert(
    data.series[0]?.name === "first" && data.series[1]?.name === "second",
    `series must be ordered by sortOrder (0, 1), not by array position (second, first) — got ${data.series.map((s) => s.name).join(",")}`,
  );
  assert(
    data.series[0]?.points[0]?.v === 1 && data.series[1]?.points[0]?.v === 2,
    "each series carries the history resolved for its own point ref",
  );

  const missingHistory = widgetDataFor(chartWidget([first]), new Map(), new Map());
  assert(
    missingHistory.status === "ready" && missingHistory.series[0]?.points.length === 0,
    "a point absent from historyByRef contributes an empty series rather than throwing",
  );
}
