/**
 * The widget config form model (`F3.1d` Unit 1 — extracted out of
 * `template-dashboard-form.ts`, `F3.1e`/ADR 0038 Amendment 4; ADR 0047
 * Amendment 3).
 */
import {
  chartSeriesKindSchema,
  widgetToneSchema,
  widgetTypeSchema,
  MAX_GAUGE_THRESHOLDS,
} from "@bms/shared";

import { CHART_SERIES, WIDGET_CATALOG } from "./widget-catalog";
import {
  CHART_SERIES_OPTIONS,
  CHART_SERIES_VALUES,
  MAX_DECIMALS,
  MAX_UNIT_LENGTH,
  MAX_WIDGET_TITLE_LENGTH,
  MAX_WINDOW_MINUTES,
  MAX_Y_AXIS_LABEL_LENGTH,
  WIDGET_TONES,
  WIDGET_TYPE_LABELS,
  WIDGET_TYPES,
  blankConfigRow,
  buildChartConfig,
  buildGaugeConfig,
  buildTankConfig,
  buildTileConfig,
  widgetConfigErrors,
} from "./widget-config-form";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The vocabulary constants — derived from `@bms/shared` and `widget-catalog.ts`, never restated. */
export function runVocabularyDerivationTests(): void {
  assert(
    JSON.stringify(WIDGET_TONES) === JSON.stringify(widgetToneSchema.options),
    "WIDGET_TONES must be exactly widgetToneSchema.options",
  );
  assert(
    JSON.stringify(WIDGET_TYPES) === JSON.stringify(widgetTypeSchema.options),
    "WIDGET_TYPES must be exactly widgetTypeSchema.options",
  );
  assert(
    JSON.stringify(CHART_SERIES_VALUES) === JSON.stringify(chartSeriesKindSchema.options),
    "CHART_SERIES_VALUES must be exactly chartSeriesKindSchema.options",
  );

  for (const type of widgetTypeSchema.options) {
    assert(
      WIDGET_TYPE_LABELS[type] === WIDGET_CATALOG[type].label,
      `WIDGET_TYPE_LABELS.${type} must come from WIDGET_CATALOG, not a restated literal`,
    );
  }

  assert(
    CHART_SERIES_OPTIONS.length === chartSeriesKindSchema.options.length,
    "CHART_SERIES_OPTIONS must name exactly one option per chart series kind",
  );
  for (const option of CHART_SERIES_OPTIONS) {
    assert(
      option.label === CHART_SERIES[option.value].label,
      `CHART_SERIES_OPTIONS label for "${option.value}" must come from CHART_SERIES, not a restated literal`,
    );
  }
}

/** Every field bound this file exports is pinned against the shared contract it mirrors. */
export function runFieldBoundConstantsTests(): void {
  assert(MAX_WIDGET_TITLE_LENGTH === 255, "a widget title is capped at 255 characters");
  assert(MAX_UNIT_LENGTH === 32, "a unit is capped at 32 characters");
  assert(MAX_DECIMALS === 6, "decimals is capped at 6");
  assert(MAX_WINDOW_MINUTES === 525_600, "a chart window is capped at 525,600 minutes");
  assert(MAX_Y_AXIS_LABEL_LENGTH === 64, "a y-axis label is capped at 64 characters");
}

/** A blank config row starts with a valid gauge range and every other field empty/off. */
export function runBlankConfigRowTests(): void {
  const row = blankConfigRow();
  assert(row.unit === "" && row.decimals === "", "unit/decimals start unset");
  assert(row.min === "0" && row.max === "100", "a blank row's gauge range is valid by default");
  assert(row.thresholds.length === 0, "a blank row starts with no threshold bands");
  assert(row.fullScale === "1" && row.fillTone === "", "tank_level fields start at a safe default");
  assert(row.abbreviate === false, "value_tile's abbreviate starts off");
  assert(row.series === "line" && row.windowMinutes === "" && !row.stacked, "chart fields start at a safe default");
}

/** `widgetConfigErrors` — the config half of `dashboardFormErrors`, called directly on the
 * `{widgetType, config}` shape it actually reads (never the full row). */
export function runWidgetConfigErrorsTests(): void {
  const blank = blankConfigRow();

  // unit / decimals, common to every arm.
  const badUnit = widgetConfigErrors(0, 0, { widgetType: "value_tile", config: { ...blank, unit: "u".repeat(33) } });
  assert(badUnit.some((p) => p.field === "unit"), "32 is the unit cap");

  const badDecimals = widgetConfigErrors(0, 0, { widgetType: "value_tile", config: { ...blank, decimals: "7" } });
  assert(badDecimals.some((p) => p.field === "decimals"), "decimals is 0-6");

  // radial_gauge: min/max required, ordered; thresholds capped.
  const invertedRange = widgetConfigErrors(0, 0, {
    widgetType: "radial_gauge",
    config: { ...blank, min: "10", max: "5" },
  });
  assert(invertedRange.some((p) => p.field === "max"), "an inverted gauge range is refused");

  const missingMin = widgetConfigErrors(0, 0, { widgetType: "radial_gauge", config: { ...blank, min: "" } });
  assert(missingMin.some((p) => p.field === "min"), "an empty gauge minimum is refused");

  const tooManyThresholds = widgetConfigErrors(0, 0, {
    widgetType: "radial_gauge",
    config: {
      ...blank,
      thresholds: Array.from({ length: MAX_GAUGE_THRESHOLDS + 1 }, () => ({ value: "1", tone: "ok" as const })),
    },
  });
  assert(tooManyThresholds.some((p) => p.field === "thresholds"), `more than ${MAX_GAUGE_THRESHOLDS} bands is refused`);

  // tank_level: fullScale required, positive.
  const badTank = widgetConfigErrors(0, 0, { widgetType: "tank_level", config: { ...blank, fullScale: "0" } });
  assert(badTank.some((p) => p.field === "fullScale"), "a zero full-scale is refused");

  // value_tile: nothing required.
  const tile = widgetConfigErrors(0, 0, { widgetType: "value_tile", config: blank });
  assert(tile.length === 0, `a bare value tile has no problems — got ${JSON.stringify(tile)}`);

  // chart: series required, windowMinutes bounded.
  const badWindow = widgetConfigErrors(0, 0, {
    widgetType: "chart",
    config: { ...blank, series: "line", windowMinutes: "0" },
  });
  assert(badWindow.some((p) => p.field === "windowMinutes"), "a zero window is refused");

  const okChart = widgetConfigErrors(0, 0, { widgetType: "chart", config: { ...blank, series: "line" } });
  assert(okChart.length === 0, `a bare chart with a series has no problems — got ${JSON.stringify(okChart)}`);
}

/** The four `WidgetConfigRow → DashboardWidgetSpec["config"]` builders omit unset optional
 * fields rather than sending them empty/NaN, and always send what is required. */
export function runConfigBuilderTests(): void {
  const blank = blankConfigRow();

  const tile = buildTileConfig(blank);
  assert(!("unit" in tile), "an empty unit is omitted");
  assert(!("decimals" in tile), "an empty decimals is omitted");
  assert(!("abbreviate" in tile), "abbreviate is omitted when false");

  const abbreviated = buildTileConfig({ ...blank, abbreviate: true, unit: "kW", decimals: "2" });
  assert(abbreviated.abbreviate === true, "abbreviate is sent when true");
  assert(abbreviated.unit === "kW" && abbreviated.decimals === 2, "a set unit/decimals is sent");

  const gauge = buildGaugeConfig({ ...blank, min: "0", max: "100" });
  assert(gauge.min === 0 && gauge.max === 100, "min/max are always sent as numbers");
  assert(!("thresholds" in gauge), "no thresholds entered means the key is absent, not []");

  const gaugeWithThresholds = buildGaugeConfig({
    ...blank,
    thresholds: [{ value: "10", tone: "warning" }, { value: "", tone: "ok" }],
  });
  assert(
    gaugeWithThresholds.thresholds?.length === 1,
    "a threshold with no numeric value is dropped, not sent as NaN",
  );

  const tank = buildTankConfig({ ...blank, fullScale: "5", fillTone: "" });
  assert(tank.fullScale === 5, "fullScale is always sent as a number");
  assert(!("fillTone" in tank), "an unset fillTone is omitted");

  const tankWithTone = buildTankConfig({ ...blank, fullScale: "5", fillTone: "critical" });
  assert(tankWithTone.fillTone === "critical", "a set fillTone is sent");

  const chart = buildChartConfig({ ...blank, series: "bar" });
  assert(chart.series === "bar", "series is always sent — it is required");
  assert(!("windowMinutes" in chart), "an unset windowMinutes is omitted");
  assert(!("stacked" in chart), "stacked is omitted when false");
  assert(!("yAxisLabel" in chart), "an empty yAxisLabel is omitted");

  const chartFull = buildChartConfig({ ...blank, series: "area", windowMinutes: "60", stacked: true, yAxisLabel: "kW" });
  assert(chartFull.windowMinutes === 60, "a set windowMinutes is sent as a number");
  assert(chartFull.stacked === true, "stacked is sent when true");
  assert(chartFull.yAxisLabel === "kW", "a set yAxisLabel is sent");
}
