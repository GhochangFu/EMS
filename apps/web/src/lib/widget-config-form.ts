import {
  GAUGE_RANGE_MESSAGE,
  MAX_GAUGE_THRESHOLDS,
  chartSeriesKindSchema,
  gaugeRangeIsOrdered,
  widgetToneSchema,
  widgetTypeSchema,
} from "@bms/shared";
import { CHART_SERIES, WIDGET_CATALOG } from "./widget-catalog";
import type { ChartSeriesKind, DashboardWidgetSpec, WidgetType } from "@bms/shared";
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

/** `chartConfigSchema.windowMinutes` — `dashboard-builder.ts:169`. */
export const MAX_WINDOW_MINUTES = 525_600;

/** `chartConfigSchema.yAxisLabel` — `dashboard-builder.ts:171`. */
export const MAX_Y_AXIS_LABEL_LENGTH = 64;

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
  // chart
  series: ChartSeriesKind;
  windowMinutes: string;
  stacked: boolean;
  yAxisLabel: string;
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
    series: "line",
    windowMinutes: "",
    stacked: false,
    yAxisLabel: "",
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
  } else if (widget.widgetType === "chart") {
    if (!CHART_SERIES_VALUES.includes(config.series)) {
      push("series", "Choose what kind of chart this is.");
    }
    if (config.windowMinutes.trim() !== "") {
      const windowMinutes = Number(config.windowMinutes);
      if (
        !Number.isInteger(windowMinutes) ||
        windowMinutes <= 0 ||
        windowMinutes > MAX_WINDOW_MINUTES
      ) {
        push(
          "windowMinutes",
          `The window is a positive integer of at most ${MAX_WINDOW_MINUTES} minutes.`,
        );
      }
    }
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
  return out;
}

export function buildChartConfig(config: WidgetConfigRow): ChartConfig {
  const out: ChartConfig = {
    ...buildCommonConfig(config),
    series: config.series,
  };
  if (config.windowMinutes.trim() !== "") {
    const windowMinutes = Number(config.windowMinutes);
    if (Number.isFinite(windowMinutes)) {
      out.windowMinutes = windowMinutes;
    }
  }
  if (config.stacked) {
    out.stacked = true;
  }
  const yAxisLabel = config.yAxisLabel.trim();
  if (yAxisLabel !== "") {
    out.yAxisLabel = yAxisLabel;
  }
  return out;
}
