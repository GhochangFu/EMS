import { CATALOG_CODE_PATTERN } from "../constants";
import { SMOC_STANDARD_SITE_TEMPLATE } from "../site-templates/smoc-standard";
import type { SeriesRole } from "../types/trend-strip";

import { widgetWriteSchema } from "./dashboard-writes";
import {
  TREND_STRIP_MAX_ASSETS_PER_POINT,
  TREND_STRIP_MAX_SERIES,
  trendStripRangeSchema,
} from "./trend-strip";
import {
  SERIES_ROLE_NAMES,
  TREND_STRIP_WIDGET_MAX_POINTS,
  TREND_STRIP_WIDGET_ROWS,
  pointSelectionPattern,
  seriesRoleSchema,
  TREND_STRIP_POINT_STYLES,
  trendStripWidgetConfigSchema,
} from "./trend-strip-widget";

/**
 * `F4.305` U1 (ADR 0108 Amendment 3) — the `trend_strip` widget's stored config and its height.
 * Assertions here; the sibling `.test.ts` is the Vitest entry (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertTheWidgetIsFourRowsTall(): void {
  assert(TREND_STRIP_WIDGET_ROWS === 4, `the strip is 4 grid rows, got ${TREND_STRIP_WIDGET_ROWS}`);
}

export function assertTheConfigIsAPlainObject(): void {
  // Plain `ZodObject`: the write side composes `.strict()` onto it (`bindsNothingArm`).
  assert(
    typeof (trendStripWidgetConfigSchema as unknown as { strict?: unknown }).strict === "function",
    "the config schema must be a plain ZodObject so .strict() is available",
  );
}

export function assertAnEmptyConfigFails(): void {
  assert(
    trendStripWidgetConfigSchema.safeParse({}).success === false,
    "defaultRange is required: an empty config must fail",
  );
}

export function assertEachRangeAndAnOptionalTabKeyParse(): void {
  for (const defaultRange of ["24h", "7d", "30d"]) {
    assert(
      trendStripWidgetConfigSchema.safeParse({ defaultRange }).success,
      `${defaultRange} must parse`,
    );
  }
  assert(
    trendStripWidgetConfigSchema.safeParse({ tabKey: "hvac", defaultRange: "7d" }).success,
    "a tabKey beside a range must parse",
  );
}

export function assertTheRangesEqualTheStripQueryRanges(): void {
  const shape = trendStripWidgetConfigSchema.shape.defaultRange.options;
  assert(
    JSON.stringify(shape) === JSON.stringify(trendStripRangeSchema.options),
    `the widget ranges must equal the strip query ranges, got ${JSON.stringify(shape)}`,
  );
}

export function assertAnUnknownRangeOrKeyFails(): void {
  assert(
    trendStripWidgetConfigSchema.safeParse({ defaultRange: "1y" }).success === false,
    "1y is not a range",
  );
  assert(
    trendStripWidgetConfigSchema.safeParse({ tabKey: "Bad Key", defaultRange: "24h" }).success === false,
    "a tabKey must be a tab key (lowercase letters, digits, hyphens)",
  );
}

// ---------------------------------------------------------------------------------------------
// `F4.306` U1 (ADR 0108 Amendment 7) — the selection: `segments`, `points`, `colors`.
// ---------------------------------------------------------------------------------------------

/** One `trend_strip` write widget, the shape `PUT /dashboards/:id/widgets` carries. */
function writeStrip(config: Record<string, unknown>) {
  return {
    gridX: 0,
    gridY: 0,
    gridW: 12,
    gridH: 4,
    widgetType: "trend_strip",
    config,
    points: [],
  };
}

function writeIssues(config: Record<string, unknown>): string {
  const result = widgetWriteSchema.safeParse(writeStrip(config));
  return result.success ? "" : JSON.stringify(result.error.issues.map((i) => i.path));
}

export function assertEachSelectionFieldAloneAndAllThreeParse(): void {
  const cases: Record<string, unknown>[] = [
    { defaultRange: "24h", segments: ["hvac"] },
    { defaultRange: "24h", points: ["hvac:supply_temp_c"] },
    { defaultRange: "24h", colors: { "hvac:supply_temp_c": "series-1" } },
    {
      tabKey: "hvac",
      defaultRange: "7d",
      segments: ["hvac", "electrical"],
      points: ["hvac:supply_temp_c", "electrical:kw_total"],
      colors: { "hvac:supply_temp_c": "series-8", "electrical:kw_total": "series-2" },
    },
  ];
  for (const config of cases) {
    assert(trendStripWidgetConfigSchema.safeParse(config).success, `${JSON.stringify(config)} must parse`);
    assert(writeIssues(config) === "", `${JSON.stringify(config)} must parse as a write: ${writeIssues(config)}`);
  }
}

export function assertTheEightSeriesRoles(): void {
  const expected = ["series-1", "series-2", "series-3", "series-4", "series-5", "series-6", "series-7", "series-8"];
  assert(
    JSON.stringify(SERIES_ROLE_NAMES) === JSON.stringify(expected),
    `the series roles are series-1 to series-8, got ${JSON.stringify(SERIES_ROLE_NAMES)}`,
  );
  const role: SeriesRole = "series-3";
  assert(seriesRoleSchema.safeParse(role).success, "series-3 is a role");
}

export function assertAnUnknownSelectionKeyIsRefusedOnWrite(): void {
  assert(
    writeIssues({ defaultRange: "24h", segments: ["hvac"], series: ["hvac"] }).includes('"config"'),
    "an undeclared config key must be refused at config",
  );
  assert(writeIssues({ defaultRange: "24h", segments: ["hvac"] }) === "", "the positive neighbour must parse");
}

function thirtyPoints(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `hvac:p_${i}`);
}

export function assertAThirtyFirstPointIsRefused(): void {
  assert(TREND_STRIP_WIDGET_MAX_POINTS === 30, `the cap is 30, got ${TREND_STRIP_WIDGET_MAX_POINTS}`);
  assert(
    writeIssues({ defaultRange: "24h", segments: ["hvac"], points: thirtyPoints(30) }) === "",
    "30 points must parse",
  );
  assert(
    writeIssues({ defaultRange: "24h", segments: ["hvac"], points: thirtyPoints(31) }) ===
      JSON.stringify([["config", "points"]]),
    `a 31st point must be refused at config.points, got ${writeIssues({ defaultRange: "24h", segments: ["hvac"], points: thirtyPoints(31) })}`,
  );
}

export function assertThirtyOneSegmentsAreRefused(): void {
  const segments = Array.from({ length: 31 }, (_, i) => `seg_${i}`);
  assert(
    writeIssues({ defaultRange: "24h", segments: segments.slice(0, 30) }) === "",
    "30 segments must parse",
  );
  assert(
    writeIssues({ defaultRange: "24h", segments }) === JSON.stringify([["config", "segments"]]),
    "a 31st segment must be refused at config.segments",
  );
}

export function assertAnEmptySegmentsListIsRefused(): void {
  assert(
    writeIssues({ defaultRange: "24h", segments: [] }) === JSON.stringify([["config", "segments"]]),
    `an empty segments list must be refused at config.segments, got ${writeIssues({ defaultRange: "24h", segments: [] })}`,
  );
}

export function assertAnEmptyPointsListIsRefused(): void {
  assert(
    writeIssues({ defaultRange: "24h", segments: ["hvac"], points: [] }) ===
      JSON.stringify([["config", "points"]]),
    "an empty points list must be refused at config.points",
  );
}

export function assertAMalformedPointIsRefused(): void {
  for (const bad of ["hvac_supply", "hvac:supply:temp", "hvac:supply temp", ":supply", "hvac:", "hv ac:supply"]) {
    assert(
      writeIssues({ defaultRange: "24h", segments: ["hvac"], points: [bad] }) ===
        JSON.stringify([["config", "points", 0]]),
      `${JSON.stringify(bad)} is not domain:code and must be refused at config.points.0`,
    );
    assert(
      writeIssues({ defaultRange: "24h", colors: { [bad]: "series-1" } }).includes('"colors"'),
      `${JSON.stringify(bad)} is not domain:code and must be refused as a colors key`,
    );
  }
  assert(
    writeIssues({ defaultRange: "24h", segments: ["hv ac"] }) === JSON.stringify([["config", "segments", 0]]),
    "a segment code with a space must be refused",
  );
}

export function assertTheCodePatternIsTheCatalogPattern(): void {
  const code = CATALOG_CODE_PATTERN.source.slice(1, -1);
  assert(
    pointSelectionPattern.source === `^${code}:${code}$`,
    `the point pattern must be built from CATALOG_CODE_PATTERN, got ${pointSelectionPattern.source}`,
  );
}

export function assertAColourOutsideTheSeriesRolesIsRefused(): void {
  assert(
    writeIssues({ defaultRange: "24h", colors: { "hvac:supply_temp_c": "accent" } }) ===
      JSON.stringify([["config", "colors", "hvac:supply_temp_c"]]),
    "accent is not a series role and must be refused",
  );
}

export function assertTheStockStripsRoundTripByteEqual(): void {
  let strips = 0;
  for (const tab of SMOC_STANDARD_SITE_TEMPLATE.content.tabs) {
    for (const widget of tab.widgets) {
      if (widget.widgetType !== "trend_strip") {
        continue;
      }
      strips += 1;
      const input = JSON.stringify(widget.config);
      const parsed = trendStripWidgetConfigSchema.parse(widget.config);
      assert(JSON.stringify(parsed) === input, `${widget.key}: ${JSON.stringify(parsed)} !== ${input}`);
      const written = widgetWriteSchema.parse(
        writeStrip(widget.config as Record<string, unknown>),
      ) as { config: unknown };
      assert(JSON.stringify(written.config) === input, `${widget.key} write: ${JSON.stringify(written.config)}`);
    }
  }
  assert(strips >= 2, `the stock template holds a strip per tab, found ${strips}`);
}

export function assertThirtyPointsOfSixAssetsFillTheSeriesCap(): void {
  assert(
    TREND_STRIP_WIDGET_MAX_POINTS * TREND_STRIP_MAX_ASSETS_PER_POINT === TREND_STRIP_MAX_SERIES,
    `${TREND_STRIP_WIDGET_MAX_POINTS} x ${TREND_STRIP_MAX_ASSETS_PER_POINT} must equal ${TREND_STRIP_MAX_SERIES}`,
  );
}


// ---------------------------------------------------------------------------------------------
// `F4.322` PR 3 (ADR 0108 Amendment 8) — a draw style per selected point.
// ---------------------------------------------------------------------------------------------

export function assertTheStylesField(): void {
  assert(
    JSON.stringify(TREND_STRIP_POINT_STYLES) === JSON.stringify(["line", "area", "bar"]),
    `the styles are line, area and bar, got ${JSON.stringify(TREND_STRIP_POINT_STYLES)}`,
  );
  for (const config of [
    { defaultRange: "24h", styles: { "hvac:supply_temp_c": "area" } },
    {
      defaultRange: "7d",
      segments: ["hvac"],
      points: ["hvac:supply_temp_c", "hvac:kw"],
      colors: { "hvac:kw": "series-2" },
      styles: { "hvac:supply_temp_c": "bar", "hvac:kw": "line" },
    },
  ]) {
    assert(trendStripWidgetConfigSchema.safeParse(config).success, `${JSON.stringify(config)} must parse`);
    assert(writeIssues(config) === "", `${JSON.stringify(config)} must parse as a write: ${writeIssues(config)}`);
  }
  assert(
    writeIssues({ defaultRange: "24h", styles: { "hvac:kw": "dots" } }).includes('"styles"'),
    "an unknown style is refused",
  );
  assert(
    writeIssues({ defaultRange: "24h", styles: { "not a key": "line" } }).includes('"styles"'),
    "a key that is not domain:code is refused",
  );
}
