import {
  GAUGE_RANGE_MESSAGE,
  MAX_GAUGE_THRESHOLDS,
  MAX_WIDGET_WINDOW_MINUTES,
  chartSeriesKindSchema,
  gaugeRangeIsOrdered,
  pointAggregateFunctionSchema,
  widgetIconSchema,
  widgetToneSchema,
  widgetTypeSchema,
} from "@bms/shared";
import { CHART_SERIES, WIDGET_CATALOG } from "./widget-catalog";
import type {
  ChartSeriesKind,
  DashboardWidgetSpec,
  PointAggregateFunction,
  WidgetIcon,
  WidgetType,
} from "@bms/shared";
import type { DashboardFormProblem } from "./template-dashboard-form";

/**
 * The widget config form model, extracted out of `template-dashboard-form.ts`
 * (`F3.1d` Unit 1). Both the template-authoring Dashboards tab (`F3.1e`) and
 * `F3.1d`'s live dashboard builder edit the same four
 * `DashboardWidgetSpec["config"]` shapes — a second gauge `max > min` check,
 * a second decimals bound and a second thresholds editor is the duplication
 * §4 forbids. `template-dashboard-form.ts` re-exports the symbols its own
 * consumers already imported, so this move changes no import path outside
 * this file and `template-dashboard-form.ts` itself.
 *
 * Only a type import comes back from `template-dashboard-form.ts`
 * (`DashboardFormProblem`), which TypeScript erases at compile time — there
 * is no runtime import cycle between the two files.
 */

/** Every field this form can validate is optional except `series`; a config
 * row therefore carries all sixteen fields regardless of `widgetType`, and
 * only the fields the active type uses are read when building the payload. */
export type WidgetTone = "ok" | "info" | "warning" | "critical";

/** `widgetToneSchema.options` from `@bms/shared` — never restated. */
export const WIDGET_TONES: readonly WidgetTone[] = widgetToneSchema.options;

/** `widgetTypeSchema.options` from `@bms/shared` — never restated. */
export const WIDGET_TYPES: readonly WidgetType[] = widgetTypeSchema.options;

/** `chartSeriesKindSchema.options` from `@bms/shared` — never restated. */
export const CHART_SERIES_VALUES: readonly ChartSeriesKind[] = chartSeriesKindSchema.options;

/** `pointAggregateFunctionSchema.options` from `@bms/shared` — never restated (`F3.35`). */
export const AGGREGATE_FUNCTIONS: readonly PointAggregateFunction[] =
  pointAggregateFunctionSchema.options;

/** `widgetIconSchema.options` from `@bms/shared` — never restated (`F3.35`). */
export const WIDGET_ICONS: readonly WidgetIcon[] = widgetIconSchema.options;

/**
 * The four aggregate functions as an author reads them.
 *
 * Plain words, never the SQL name: an administrator with no programming skill
 * composes these (Sheet 02), and "sum" beside "avg" is a column list. The
 * `Record` over the enum makes a fifth function a compile error here rather
 * than an unlabelled option in a select.
 */
export const AGGREGATE_FUNCTION_LABELS: Readonly<Record<PointAggregateFunction, string>> = {
  sum: "Total",
  avg: "Average",
  min: "Lowest",
  max: "Highest",
};

/** The six tile icons as an author reads them. Same `Record`-over-the-enum gate. */
export const WIDGET_ICON_LABELS: Readonly<Record<WidgetIcon, string>> = {
  alert: "Alert",
  clipboard: "Tasks",
  bolt: "Energy",
  drop: "Water",
  recycle: "Recycled",
  gauge: "Efficiency",
};

/** Labels stay local — `F3.1c`'s `widget-catalog.ts` does not exist yet
 * (§5.4). This is a recorded residual for that item to fold in. */
export const WIDGET_TYPE_LABELS: Record<WidgetType, string> = Object.fromEntries(
  widgetTypeSchema.options.map((type) => [type, WIDGET_CATALOG[type].label]),
) as Record<WidgetType, string>;

/**
 * The plain label an author sees, and the contract value it writes.
 *
 * **`area` is a legal contract value, not a mistake.** The ECharts
 * translation (`area` → `line` series + `areaStyle`) is `F3.1c`'s, downstream
 * of this contract.
 *
 * **Derived from `F3.1c`'s catalog rather than restated.** Both rows landed in
 * the same wave and each wrote these four labels independently; `F3.1c` landed
 * second, so the copies are collapsed here onto `CHART_SERIES`, which is where
 * ADR 0047 Amendment 2 §4 rules them. `WIDGET_TYPE_LABELS` above was the same
 * duplication and is derived the same way. The specs that pin the label text
 * still pin it — they now check the derivation instead of a second literal.
 */
export const CHART_SERIES_OPTIONS: readonly { label: string; value: ChartSeriesKind }[] =
  chartSeriesKindSchema.options.map((value) => ({ label: CHART_SERIES[value].label, value }));

/** A widget title — `templateWidgetIdentityFields.title`,
 * `asset-templates-content.schema.ts:295`. */
export const MAX_WIDGET_TITLE_LENGTH = 255;

/** `commonConfigFields.unit` — `dashboard-builder.ts:97`. */
export const MAX_UNIT_LENGTH = 32;

/** `commonConfigFields.decimals` — `dashboard-builder.ts:98`. */
export const MAX_DECIMALS = 6;

/**
 * The window bound both widget configs carry — **derived, never restated**
 * (compliance review).
 *
 * This is the one constant here that decides whether a save is refused, so a
 * second copy of `525_600` is the one that matters: the direction that drifts
 * silently is the form admitting a window the contract refuses, and the author
 * then gets a 400 they cannot read. `tests/f3.35-aggregate-window-bounds.test.ts`
 * holds the shared declaration equal to the API's ladder; this line puts the
 * form on the same declaration rather than beside it.
 */
export const MAX_WINDOW_MINUTES = MAX_WIDGET_WINDOW_MINUTES;

/** `chartConfigSchema.yAxisLabel` — `dashboard-builder.ts:171`. */
export const MAX_Y_AXIS_LABEL_LENGTH = 64;

/** `valueTileConfigSchema.hint` — `F3.35`. `KpiTile` renders it at 11px on one line. */
export const MAX_HINT_LENGTH = 120;

/**
 * The window bound, checked identically for a tile and a chart.
 *
 * Shared rather than restated because `F3.35` gave the tile the chart's own
 * bound: two copies would drift, and the direction that drifts silently is the
 * one where the form admits a window the contract refuses — a save that fails
 * with a 400 the author cannot read.
 */
function pushWindowProblem(raw: string, push: (field: string, message: string) => void): void {
  if (raw.trim() === "") {
    return;
  }
  const windowMinutes = Number(raw);
  if (!Number.isInteger(windowMinutes) || windowMinutes <= 0 || windowMinutes > MAX_WINDOW_MINUTES) {
    push("windowMinutes", `The window is a positive integer of at most ${MAX_WINDOW_MINUTES} minutes.`);
  }
}

/** One coloured band on a radial gauge, as edited. `value` is text so a
 * partially typed number does not have to be a valid one. */
export type ThresholdRow = { value: string; tone: WidgetTone };

/**
 * Every optional field the contract carries across all four widget types,
 * flattened into one row. Numbers are text so an in-progress edit (`""`,
 * `"-"`, `"1."`) does not have to parse. `""` means "not set" throughout,
 * mirroring `TemplateKpiRow.unit` (`template-kpi-form.ts:64-72`).
 */
export type WidgetConfigRow = {
  unit: string;
  decimals: string;
  // radial_gauge
  min: string;
  max: string;
  thresholds: ThresholdRow[];
  // tank_level
  fullScale: string;
  fillTone: WidgetTone | "";
  // value_tile
  abbreviate: boolean;
  // value_tile — `F3.35` Stage A (ADR 0048). `""` is "not set", the `fillTone`
  // idiom, and for `aggregate` it means "show the latest live sample" rather
  // than a window's number: the tile's behaviour before this row.
  aggregate: PointAggregateFunction | "";
  compareToPrevious: boolean;
  icon: WidgetIcon | "";
  hint: string;
  tone: WidgetTone | "";
  // chart
  series: ChartSeriesKind;
  windowMinutes: string;
  stacked: boolean;
  yAxisLabel: string;
  // chart — `F3.35` Stage A. `chartAggregate` is named apart from the tile's
  // `aggregate` because one flat row serves all four widget types, and the two
  // fields mean different things: the tile picks WHICH statistic to show, the
  // chart decides whether to plot buckets at all.
  chartAggregate: PointAggregateFunction | "";
  footerStats: boolean;
};

export function blankConfigRow(): WidgetConfigRow {
  return {
    unit: "",
    decimals: "",
    min: "0",
    max: "100",
    thresholds: [],
    fullScale: "1",
    fillTone: "",
    abbreviate: false,
    aggregate: "",
    compareToPrevious: false,
    icon: "",
    hint: "",
    tone: "",
    series: "line",
    windowMinutes: "",
    stacked: false,
    yAxisLabel: "",
    chartAggregate: "",
    footerStats: false,
  };
}

/**
 * The config half of `dashboardFormErrors` — one widget's `config` block,
 * checked against the bounds its `widgetType` uses. Takes the narrow
 * `{widgetType, config}` shape rather than a full row type, so this file
 * needs no runtime import of `TemplateDashboardWidgetRow` from
 * `template-dashboard-form.ts` — every row shape in this codebase that
 * carries those two fields satisfies it structurally.
 */
export function widgetConfigErrors(
  viewIndex: number,
  widgetIndex: number,
  widget: { widgetType: WidgetType; config: WidgetConfigRow },
): DashboardFormProblem[] {
  const problems: DashboardFormProblem[] = [];
  const push = (field: string, message: string) =>
    problems.push({ view: viewIndex, widget: widgetIndex, field, message });
  const { config } = widget;

  if (config.unit.trim().length > MAX_UNIT_LENGTH) {
    push("unit", `A unit is at most ${MAX_UNIT_LENGTH} characters.`);
  }
  if (config.decimals.trim() !== "") {
    const decimals = Number(config.decimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
      push("decimals", `Decimals is an integer from 0 to ${MAX_DECIMALS}.`);
    }
  }

  if (widget.widgetType === "radial_gauge") {
    const min = Number(config.min);
    const max = Number(config.max);
    const minOk = config.min.trim() !== "" && Number.isFinite(min);
    const maxOk = config.max.trim() !== "" && Number.isFinite(max);
    if (!minOk) {
      push("min", "A gauge needs a numeric minimum.");
    }
    if (!maxOk) {
      push("max", "A gauge needs a numeric maximum.");
    }
    if (minOk && maxOk && !gaugeRangeIsOrdered({ min, max })) {
      push("max", GAUGE_RANGE_MESSAGE);
    }
    if (config.thresholds.length > MAX_GAUGE_THRESHOLDS) {
      push("thresholds", `A gauge holds at most ${MAX_GAUGE_THRESHOLDS} threshold bands.`);
    }
    config.thresholds.forEach((threshold, thresholdIndex) => {
      if (threshold.value.trim() === "" || !Number.isFinite(Number(threshold.value))) {
        problems.push({
          view: viewIndex,
          widget: widgetIndex,
          field: `thresholds.${thresholdIndex}.value`,
          message: "A threshold band needs a numeric value.",
        });
      }
    });
  } else if (widget.widgetType === "tank_level") {
    const fullScale = Number(config.fullScale);
    if (config.fullScale.trim() === "" || !Number.isFinite(fullScale) || fullScale <= 0) {
      push("fullScale", "A tank level needs a positive full-scale value.");
    }
  } else if (widget.widgetType === "value_tile") {
    // `F3.35` — the tile now carries a window too, bounded by the SAME
    // constant the chart uses rather than a second one. A window without an
    // aggregate is not checked, because `buildTileConfig` does not write it.
    if (config.aggregate !== "") {
      pushWindowProblem(config.windowMinutes, push);
    }
    if (config.hint.trim().length > MAX_HINT_LENGTH) {
      push("hint", `A sub-line is at most ${MAX_HINT_LENGTH} characters.`);
    }
  } else if (widget.widgetType === "chart") {
    if (!CHART_SERIES_VALUES.includes(config.series)) {
      push("series", "Choose what kind of chart this is.");
    }
    pushWindowProblem(config.windowMinutes, push);
    if (config.yAxisLabel.trim().length > MAX_Y_AXIS_LABEL_LENGTH) {
      push("yAxisLabel", `A y-axis label is at most ${MAX_Y_AXIS_LABEL_LENGTH} characters.`);
    }
  }

  return problems;
}

type GaugeConfig = Extract<DashboardWidgetSpec, { widgetType: "radial_gauge" }>["config"];
type TankConfig = Extract<DashboardWidgetSpec, { widgetType: "tank_level" }>["config"];
type TileConfig = Extract<DashboardWidgetSpec, { widgetType: "value_tile" }>["config"];
type ChartConfig = Extract<DashboardWidgetSpec, { widgetType: "chart" }>["config"];

/** `unit`/`decimals` are common to every arm's config and are added only when
 * set — every config schema is `.optional()` on both and `.strict()`, so a
 * present-and-empty/NaN value is a 400 (the `TemplateKpiRow.unit` trap,
 * one level down: `template-kpi-form.ts:11-24`). */
function buildCommonConfig(config: WidgetConfigRow): { unit?: string; decimals?: number } {
  const out: { unit?: string; decimals?: number } = {};
  const unit = config.unit.trim();
  if (unit !== "") {
    out.unit = unit;
  }
  if (config.decimals.trim() !== "") {
    const decimals = Number(config.decimals);
    if (Number.isFinite(decimals)) {
      out.decimals = decimals;
    }
  }
  return out;
}

export function buildGaugeConfig(config: WidgetConfigRow): GaugeConfig {
  const thresholds = config.thresholds
    .filter((threshold) => threshold.value.trim() !== "" && Number.isFinite(Number(threshold.value)))
    .map((threshold) => ({ value: Number(threshold.value), tone: threshold.tone }));
  const out: GaugeConfig = {
    ...buildCommonConfig(config),
    min: Number(config.min),
    max: Number(config.max),
  };
  if (thresholds.length > 0) {
    out.thresholds = thresholds;
  }
  return out;
}

export function buildTankConfig(config: WidgetConfigRow): TankConfig {
  const out: TankConfig = {
    ...buildCommonConfig(config),
    fullScale: Number(config.fullScale),
  };
  if (config.fillTone !== "") {
    out.fillTone = config.fillTone;
  }
  return out;
}

export function buildTileConfig(config: WidgetConfigRow): TileConfig {
  const out: TileConfig = { ...buildCommonConfig(config) };
  if (config.abbreviate) {
    out.abbreviate = true;
  }
  // `F3.35` — each field is written only when set. Every one is `.optional()`
  // and both write surfaces compose the schema with `.strict()`, so a
  // present-but-empty value is a 400: the `TemplateKpiRow.unit` trap this file
  // already documents, applied to five more fields.
  if (config.aggregate !== "") {
    out.aggregate = config.aggregate;
    // `windowMinutes` is only meaningful beside an aggregate — a tile showing
    // the latest live sample has no window. Written under the same condition so
    // a config cannot carry a window that nothing reads.
    const windowMinutes = parseWindowMinutes(config.windowMinutes);
    if (windowMinutes !== undefined) {
      out.windowMinutes = windowMinutes;
    }
    if (config.compareToPrevious) {
      out.compareToPrevious = true;
    }
  }
  if (config.icon !== "") {
    out.icon = config.icon;
  }
  const hint = config.hint.trim();
  if (hint !== "") {
    out.hint = hint;
  }
  if (config.tone !== "") {
    out.tone = config.tone;
  }
  return out;
}

/** `""` and an unparseable entry both mean "not set" — never `NaN`, which `.strict()` refuses. */
function parseWindowMinutes(raw: string): number | undefined {
  if (raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function buildChartConfig(config: WidgetConfigRow): ChartConfig {
  const out: ChartConfig = {
    ...buildCommonConfig(config),
    series: config.series,
  };
  const windowMinutes = parseWindowMinutes(config.windowMinutes);
  if (windowMinutes !== undefined) {
    out.windowMinutes = windowMinutes;
  }
  if (config.stacked) {
    out.stacked = true;
  }
  const yAxisLabel = config.yAxisLabel.trim();
  if (yAxisLabel !== "") {
    out.yAxisLabel = yAxisLabel;
  }
  // `F3.35` — set means "plot rolled-up buckets"; absent means the chart reads
  // raw recent readings exactly as it did before this row.
  if (config.chartAggregate !== "") {
    out.aggregate = config.chartAggregate;
  }
  if (config.footerStats) {
    out.footerStats = true;
  }
  return out;
}
