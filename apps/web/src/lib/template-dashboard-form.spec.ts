/**
 * The Dashboards tab's form rules (`F3.1e`, ADR 0038 Amendment 4; ADR 0047
 * Amendment 3).
 */
import { MAX_GAUGE_THRESHOLDS, WIDGET_POINT_CARDINALITY } from "@bms/shared";
import type { TemplateDashboardView } from "@bms/shared";

import {
  CHART_SERIES_OPTIONS,
  MAX_DASHBOARD_VIEWS,
  MAX_DASHBOARD_WIDGETS,
  MAX_FEATURED_POINTS,
  MAX_VIEW_NAME_LENGTH,
  blankDashboardView,
  blankWidgetRow,
  buildDashboardsPayload,
  dashboardFormErrors,
  dashboardRowsFrom,
  dashboardsHaveChanged,
  moveArrayItem,
  type TemplateDashboardViewRow,
  type TemplateDashboardWidgetRow,
} from "./template-dashboard-form";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DECLARED = ["FLOW", "TEMP", "PRESSURE"];

function view(overrides: Partial<TemplateDashboardViewRow> = {}): TemplateDashboardViewRow {
  return {
    name: "Overview",
    featured: ["FLOW"],
    widgets: [],
    ...overrides,
  };
}

function widget(overrides: Partial<TemplateDashboardWidgetRow> = {}): TemplateDashboardWidgetRow {
  return {
    ...blankWidgetRow("value_tile"),
    pointKeys: ["FLOW"],
    ...overrides,
  };
}

/** Reading the stored record, and what a fresh view/widget starts as. */
export function runSeedTests(): void {
  assert(dashboardRowsFrom(undefined).length === 0, "no stored dashboards seeds no rows");
  assert(dashboardRowsFrom({}).length === 0, "an empty record seeds no rows");

  const stored: Record<string, TemplateDashboardView> = {
    Overview: { featured: ["FLOW", "TEMP"] },
    Detail: {
      featured: ["PRESSURE"],
      widgets: [
        {
          widgetType: "chart",
          config: { series: "area" },
          pointKeys: ["FLOW"],
          gridX: 0,
          gridY: 0,
          gridW: 6,
          gridH: 4,
        },
      ],
    },
  };
  const rows = dashboardRowsFrom(stored);
  assert(rows.length === 2, `every stored view produces a row — got ${rows.length}`);
  assert(rows[0].name === "Overview", "the record key becomes the row name");
  assert(rows[0].featured.join(",") === "FLOW,TEMP", "featured is copied in order");
  assert(rows[1].widgets.length === 1, "widgets carry through");
  assert(rows[1].widgets[0].widgetType === "chart", "widgetType carries through");
  assert(rows[1].widgets[0].config.series === "area", "config.series carries through");

  // Copies, not aliases.
  rows[0].featured.push("X");
  assert(stored.Overview.featured.length === 2, "featured is copied, not shared with the stored object");

  const blankView = blankDashboardView();
  assert(blankView.name === "" && blankView.featured.length === 0, "a new view starts empty");

  const gauge = blankWidgetRow("radial_gauge");
  assert(gauge.widgetType === "radial_gauge", "a new widget starts as the chosen type");
  assert(gauge.config.min === "0" && gauge.config.max === "100", "a gauge defaults to a valid range");
}

/**
 * A malformed stored entry renders instead of throwing (`kpiRowsFrom`'s
 * precedent, one level down).
 */
export function runMalformedStoredEntryTests(): void {
  const stored = {
    Empty: {},
    NoFeatured: { featured: "not-an-array" },
    BadWidget: {
      featured: ["FLOW"],
      widgets: [{ widgetType: "nonsense", config: null, pointKeys: "nope" }],
    },
  } as unknown as Record<string, unknown>;

  const rows = dashboardRowsFrom(stored);
  assert(rows.length === 3, "every stored entry produces a row");
  assert(Array.isArray(rows[0].featured) && rows[0].featured.length === 0, "a missing featured reads as empty");
  assert(
    Array.isArray(rows[1].featured) && rows[1].featured.length === 0,
    "a non-array featured reads as empty rather than throwing",
  );
  assert(rows[2].widgets.length === 1, "a malformed widget still produces a row");
  assert(
    rows[2].widgets[0].widgetType === "value_tile",
    "an unrecognised widgetType reads as the safe default rather than throwing",
  );
  assert(Array.isArray(rows[2].widgets[0].pointKeys), "a non-array pointKeys reads as empty");

  // And it is then reportable rather than silently accepted.
  const problems = dashboardFormErrors(rows, DECLARED);
  assert(problems.length > 0, "a malformed row is reported, not quietly accepted");
}

/** `moveArrayItem` — the `featured` reorder primitive. */
export function runMoveArrayItemTests(): void {
  const items = ["A", "B", "C"];
  assert(moveArrayItem(items, 0, 1).join(",") === "B,A,C", "moving index 0 forward swaps with index 1");
  assert(moveArrayItem(items, 2, 1).join(",") === "A,B,C", "moving the last item forward is a no-op copy");
  assert(moveArrayItem(items, 0, -1).join(",") === "A,B,C", "moving the first item back is a no-op copy");
  assert(moveArrayItem(items, 1, -1).join(",") === "B,A,C", "moving index 1 back swaps with index 0");
  const copy = moveArrayItem(items, 0, 1);
  assert(copy !== items, "a move returns a new array, never the input");
}

/**
 * `featured` is required and `.min(1)` — a widgets-only view is not
 * representable, and the form must refuse it before Save rather than collect
 * a 400.
 */
export function runFeaturedRequiredTests(): void {
  const empty = dashboardFormErrors([view({ featured: [] })], DECLARED);
  assert(
    empty.some((problem) => problem.field === "featured"),
    "an empty featured array is refused",
  );

  const ok = dashboardFormErrors([view({ featured: ["FLOW"] })], DECLARED);
  assert(!ok.some((problem) => problem.field === "featured"), "one featured point is enough");

  const tooMany = dashboardFormErrors(
    [view({ featured: Array.from({ length: MAX_FEATURED_POINTS + 1 }, (_, i) => `K${i}`) })],
    Array.from({ length: MAX_FEATURED_POINTS + 1 }, (_, i) => `K${i}`),
  );
  assert(
    tooMany.some((problem) => problem.field === "featured"),
    "more than the cap is refused",
  );

  const atCap = dashboardFormErrors(
    [view({ featured: Array.from({ length: MAX_FEATURED_POINTS }, (_, i) => `K${i}`) })],
    Array.from({ length: MAX_FEATURED_POINTS }, (_, i) => `K${i}`),
  );
  assert(
    !atCap.some((problem) => problem.field === "featured"),
    `the cap is inclusive — got ${JSON.stringify(atCap)}`,
  );

  const undeclared = dashboardFormErrors([view({ featured: ["GONE"] })], DECLARED);
  assert(
    undeclared.some((problem) => problem.field === "featured" && problem.message.includes("GONE")),
    "a featured key the template does not declare is refused and named",
  );
}

/** View names: required, capped, unique, and never a prototype-pollution key. */
export function runViewNameTests(): void {
  assert(
    dashboardFormErrors([view({ name: "" })], DECLARED).some((p) => p.field === "name"),
    "a blank view name is refused",
  );

  const tooLong = dashboardFormErrors([view({ name: "n".repeat(MAX_VIEW_NAME_LENGTH + 1) })], DECLARED);
  assert(tooLong.some((p) => p.field === "name"), `${MAX_VIEW_NAME_LENGTH} is the view name cap`);

  const atCap = dashboardFormErrors([view({ name: "n".repeat(MAX_VIEW_NAME_LENGTH) })], DECLARED);
  assert(!atCap.some((p) => p.field === "name"), "the cap is inclusive");

  const duplicated = dashboardFormErrors([view(), view({ name: "Overview" })], DECLARED);
  assert(
    duplicated.filter((p) => p.field === "name").length === 1,
    `one duplicate name is one problem — got ${duplicated.filter((p) => p.field === "name").length}`,
  );

  for (const unsafe of ["__proto__", "constructor", "prototype"]) {
    const problems = dashboardFormErrors([view({ name: unsafe })], DECLARED);
    assert(
      problems.some((p) => p.field === "name"),
      `"${unsafe}" must be refused as a view name client-side, the way safeKeySchema refuses it server-side`,
    );
  }

  const tooMany = dashboardFormErrors(
    Array.from({ length: MAX_DASHBOARD_VIEWS + 1 }, (_, i) => view({ name: `V${i}` })),
    DECLARED,
  );
  assert(
    tooMany.some((p) => p.view === null && p.field === "views"),
    "the view-count cap is reported against the section, not a row",
  );

  const atViewCap = dashboardFormErrors(
    Array.from({ length: MAX_DASHBOARD_VIEWS }, (_, i) => view({ name: `V${i}` })),
    DECLARED,
  );
  assert(!atViewCap.some((p) => p.field === "views"), "the view-count cap is inclusive");
}

/**
 * The per-arm cardinality — the trap named in the plan: a gauge with two
 * points must be refused by the form, with the same numbers the server uses.
 */
export function runWidgetCardinalityTests(): void {
  for (const type of ["radial_gauge", "tank_level", "value_tile"] as const) {
    assert(WIDGET_POINT_CARDINALITY[type].max === 1, `fixture guard: ${type} is single-point`);
    const twoPoints = dashboardFormErrors(
      [view({ widgets: [widget({ widgetType: type, pointKeys: ["FLOW", "TEMP"] })] })],
      DECLARED,
    );
    assert(
      twoPoints.some((p) => p.field === "pointKeys"),
      `a ${type} with two points must be refused`,
    );

    const onePoint = dashboardFormErrors(
      [view({ widgets: [widget({ widgetType: type, pointKeys: ["FLOW"] })] })],
      DECLARED,
    );
    assert(
      !onePoint.some((p) => p.field === "pointKeys"),
      `a ${type} with one point must be accepted — got ${JSON.stringify(onePoint)}`,
    );

    const noPoints = dashboardFormErrors(
      [view({ widgets: [widget({ widgetType: type, pointKeys: [] })] })],
      DECLARED,
    );
    assert(noPoints.some((p) => p.field === "pointKeys"), `a ${type} with no points must be refused`);
  }

  // chart: 1..MAX_WIDGET_POINTS (8)
  const chartMax = WIDGET_POINT_CARDINALITY.chart.max;
  const eight = dashboardFormErrors(
    [
      view({
        widgets: [
          widget({
            widgetType: "chart",
            pointKeys: Array.from({ length: chartMax }, (_, i) => `K${i}`),
            config: { ...blankWidgetRow("chart").config, series: "line" },
          }),
        ],
      }),
    ],
    Array.from({ length: chartMax }, (_, i) => `K${i}`),
  );
  assert(!eight.some((p) => p.field === "pointKeys"), `a chart with ${chartMax} points is accepted`);

  const nine = dashboardFormErrors(
    [
      view({
        widgets: [
          widget({
            widgetType: "chart",
            pointKeys: Array.from({ length: chartMax + 1 }, (_, i) => `K${i}`),
            config: { ...blankWidgetRow("chart").config, series: "line" },
          }),
        ],
      }),
    ],
    Array.from({ length: chartMax + 1 }, (_, i) => `K${i}`),
  );
  assert(nine.some((p) => p.field === "pointKeys"), `a chart with ${chartMax + 1} points is refused`);
}

/** Grid bounds and the 12-column canvas check. */
export function runGridTests(): void {
  const overflow = dashboardFormErrors(
    [view({ widgets: [widget({ gridX: 10, gridW: 4 })] })],
    DECLARED,
  );
  assert(
    overflow.some((p) => p.field === "gridW"),
    "gridX + gridW over 12 is refused",
  );

  const badX = dashboardFormErrors([view({ widgets: [widget({ gridX: -1 })] })], DECLARED);
  assert(badX.some((p) => p.field === "gridX"), "a negative gridX is refused");

  const badH = dashboardFormErrors([view({ widgets: [widget({ gridH: 0 })] })], DECLARED);
  assert(badH.some((p) => p.field === "gridH"), "gridH below 1 is refused");

  const ok = dashboardFormErrors([view({ widgets: [widget({ gridX: 8, gridW: 4 })] })], DECLARED);
  assert(!ok.some((p) => p.field === "gridW"), "gridX + gridW === 12 is accepted");
}

/** A view holds at most `MAX_DASHBOARD_WIDGETS` widgets. */
export function runWidgetCountCapTests(): void {
  const tooMany = dashboardFormErrors(
    [view({ widgets: Array.from({ length: MAX_DASHBOARD_WIDGETS + 1 }, () => widget()) })],
    DECLARED,
  );
  assert(
    tooMany.some((p) => p.view === 0 && p.widget === null && p.field === "widgets"),
    "more than the cap is refused, reported against the view",
  );

  const atCap = dashboardFormErrors(
    [view({ widgets: Array.from({ length: MAX_DASHBOARD_WIDGETS }, () => widget()) })],
    DECLARED,
  );
  assert(!atCap.some((p) => p.field === "widgets"), "the widget-count cap is inclusive");
}

/** Per-type config rules — the full optional set, ruled by the owner (§11 Q1). */
export function runConfigTests(): void {
  // radial_gauge: min/max required, max > min, thresholds capped.
  const badRange = dashboardFormErrors(
    [view({ widgets: [widget({ widgetType: "radial_gauge", config: { ...blankWidgetRow("radial_gauge").config, min: "10", max: "5" } })] })],
    DECLARED,
  );
  assert(badRange.some((p) => p.field === "max"), "an inverted gauge range is refused");

  const missingMin = dashboardFormErrors(
    [view({ widgets: [widget({ widgetType: "radial_gauge", config: { ...blankWidgetRow("radial_gauge").config, min: "" } })] })],
    DECLARED,
  );
  assert(missingMin.some((p) => p.field === "min"), "an empty gauge minimum is refused");

  const tooManyThresholds = dashboardFormErrors(
    [
      view({
        widgets: [
          widget({
            widgetType: "radial_gauge",
            config: {
              ...blankWidgetRow("radial_gauge").config,
              thresholds: Array.from({ length: MAX_GAUGE_THRESHOLDS + 1 }, () => ({
                value: "1",
                tone: "ok" as const,
              })),
            },
          }),
        ],
      }),
    ],
    DECLARED,
  );
  assert(
    tooManyThresholds.some((p) => p.field === "thresholds"),
    `more than ${MAX_GAUGE_THRESHOLDS} threshold bands is refused`,
  );

  // tank_level: fullScale required, positive.
  const badTank = dashboardFormErrors(
    [view({ widgets: [widget({ widgetType: "tank_level", config: { ...blankWidgetRow("tank_level").config, fullScale: "0" } })] })],
    DECLARED,
  );
  assert(badTank.some((p) => p.field === "fullScale"), "a zero full-scale is refused");

  // value_tile: nothing required.
  const tile = dashboardFormErrors([view({ widgets: [widget({ widgetType: "value_tile" })] })], DECLARED);
  assert(tile.length === 0, `a bare value tile has no problems — got ${JSON.stringify(tile)}`);

  // chart: series required, windowMinutes bounded.
  const badWindow = dashboardFormErrors(
    [
      view({
        widgets: [
          widget({
            widgetType: "chart",
            config: { ...blankWidgetRow("chart").config, series: "line", windowMinutes: "0" },
          }),
        ],
      }),
    ],
    DECLARED,
  );
  assert(badWindow.some((p) => p.field === "windowMinutes"), "a zero window is refused");

  // unit / decimals, common to every arm.
  const badUnit = dashboardFormErrors(
    [view({ widgets: [widget({ config: { ...blankWidgetRow("value_tile").config, unit: "u".repeat(33) } })] })],
    DECLARED,
  );
  assert(badUnit.some((p) => p.field === "unit"), "32 is the unit cap");

  const badDecimals = dashboardFormErrors(
    [view({ widgets: [widget({ config: { ...blankWidgetRow("value_tile").config, decimals: "7" } })] })],
    DECLARED,
  );
  assert(badDecimals.some((p) => p.field === "decimals"), "decimals is 0-6");
}

/**
 * The chart series picker's mapping — the trap named in the plan. Writing
 * `line` where `area` belongs typechecks, saves, and stays invisible until
 * `F3.1c` renders, so the mapping is pinned here rather than merely stated.
 */
export function runChartSeriesMappingTests(): void {
  const expected: Record<string, string> = {
    Trend: "line",
    "Trend (filled)": "area",
    "Comparison bars": "bar",
    Scatter: "scatter",
  };
  assert(
    CHART_SERIES_OPTIONS.length === 4,
    `the mapping names exactly four series — got ${CHART_SERIES_OPTIONS.length}`,
  );
  for (const option of CHART_SERIES_OPTIONS) {
    assert(
      expected[option.label] === option.value,
      `"${option.label}" must write "${expected[option.label]}" — got "${option.value}"`,
    );
  }
  const filled = CHART_SERIES_OPTIONS.find((o) => o.label === "Trend (filled)");
  assert(filled?.value === "area", "area is a legal contract value, not a mistake");
}

/** `buildDashboardsPayload` always writes the complete record. */
export function runCompleteRecordTests(): void {
  const rows = [view({ name: "A", featured: ["FLOW"] }), view({ name: "B", featured: ["TEMP"] })];
  const payload = buildDashboardsPayload(rows);
  assert(Object.keys(payload).sort().join(",") === "A,B", "every valid row is present in the payload");

  // A row with no name is dropped rather than corrupting the record with a
  // blank key — the form blocks Save in this state via dashboardFormErrors.
  const withBlank = buildDashboardsPayload([...rows, view({ name: "  " })]);
  assert(Object.keys(withBlank).sort().join(",") === "A,B", "a blank-named row is not sent");

  // Deleting the last view writes {}, never removing the key at the
  // mergeTemplateContent layer — this layer's contribution is that an empty
  // rows array produces an empty record, not an absent one.
  assert(Object.keys(buildDashboardsPayload([])).length === 0, "no views produces an empty record");
}

/** Optional config fields are omitted when unset, never sent as null/NaN. */
export function runOptionalConfigOmittedTests(): void {
  const [tile] = buildDashboardsPayload([view({ widgets: [widget({ widgetType: "value_tile" })] })])
    .Overview.widgets!;
  assert(!("unit" in tile.config), "an empty unit is omitted, not sent as an empty string");
  assert(!("decimals" in tile.config), "an empty decimals is omitted");

  const [gauge] = buildDashboardsPayload([
    view({
      widgets: [
        widget({
          widgetType: "radial_gauge",
          config: { ...blankWidgetRow("radial_gauge").config, unit: "kPa", decimals: "2" },
        }),
      ],
    }),
  ]).Overview.widgets!;
  assert(gauge.config.unit === "kPa" && gauge.config.decimals === 2, "a set unit/decimals is sent");
  assert(!("thresholds" in gauge.config), "no thresholds entered means the key is absent, not []");

  const [chart] = buildDashboardsPayload([
    view({
      widgets: [widget({ widgetType: "chart", config: { ...blankWidgetRow("chart").config, series: "bar" } })],
    }),
  ]).Overview.widgets!;
  assert(chart.widgetType === "chart", "fixture guard: the built widget stayed a chart");
  if (chart.widgetType === "chart") {
    assert(chart.config.series === "bar", "series is always sent — it is required");
    assert(!("windowMinutes" in chart.config), "an unset windowMinutes is omitted");
  }
}

/**
 * `dashboardsHaveChanged` — the second of the two dirty proofs the plan
 * demands (§5.8). The `30` in `template-tab-guard.spec.ts` proves nothing
 * about this tab; this comparator is what does.
 */
export function runChangeDetectionTests(): void {
  const stored: Record<string, TemplateDashboardView> = {
    Overview: { featured: ["FLOW"] },
  };
  const rows = dashboardRowsFrom(stored);

  assert(!dashboardsHaveChanged(rows, stored), "an untouched read-back reports no change");

  assert(
    dashboardsHaveChanged([{ ...rows[0], featured: ["FLOW", "TEMP"] }], stored),
    "a field edit is a change",
  );

  const withWidget = [
    { ...rows[0], widgets: [widget({ widgetType: "value_tile", pointKeys: ["FLOW"] })] },
  ];
  assert(dashboardsHaveChanged(withWidget, stored), "adding a widget is a change");

  const reordered = [{ ...rows[0], featured: [...rows[0].featured].reverse() }];
  // featured has one entry above; use a two-entry fixture for a real reorder.
  const storedTwo: Record<string, TemplateDashboardView> = { Overview: { featured: ["FLOW", "TEMP"] } };
  const rowsTwo = dashboardRowsFrom(storedTwo);
  const swapped = [{ ...rowsTwo[0], featured: moveArrayItem(rowsTwo[0].featured, 0, 1) }];
  assert(dashboardsHaveChanged(swapped, storedTwo), "reordering featured is a change");
  void reordered;

  const withNewView = [...rows, view({ name: "Detail", featured: ["TEMP"] })];
  assert(dashboardsHaveChanged(withNewView, stored), "adding a view is a change");

  assert(dashboardsHaveChanged([], stored), "deleting the last view is a change");

  assert(!dashboardsHaveChanged([], undefined), "no rows and no stored section is no change");
}
