import {
  GAUGE_RANGE_MESSAGE,
  MAX_GAUGE_THRESHOLDS,
  WIDGET_POINT_CARDINALITY,
  chartSeriesKindSchema,
  gaugeRangeIsOrdered,
  widgetToneSchema,
  widgetTypeSchema,
} from "@bms/shared";
import type {
  ChartSeriesKind,
  DashboardWidgetSpec,
  TemplateDashboardView,
  TemplateDashboardWidget,
  WidgetType,
} from "@bms/shared";

/**
 * The Dashboards tab's form rules (`F3.1e`, ADR 0038 Amendment 4 — the sixth
 * tab; ADR 0047 Amendment 3 — the per-arm cardinality this form must refuse
 * client-side).
 *
 * ## `content.dashboards` is a record, and the write is always the whole record
 *
 * `mergeTemplateContent` replaces the whole `dashboards` key (Unit 6). A tab
 * that built `{ [oneView]: view }` would destroy every other stored view —
 * `buildDashboardsPayload` therefore always returns the **complete** record,
 * and the tab must always call it over every row, never over one.
 *
 * ## `featured` is required and `.min(1)`
 *
 * A widgets-only view is not representable in the stored shape
 * (`asset-templates-content.schema.ts:429`). `dashboardFormErrors` refuses an
 * empty `featured` before Save is ever pressed, rather than collecting the
 * API's 400.
 *
 * ## The chart series picker writes a contract value, not a label
 *
 * `CHART_SERIES_OPTIONS` is the exact mapping the plan pins: *Trend* → `line`,
 * *Trend (filled)* → `area`, *Comparison bars* → `bar`, *Scatter* → `scatter`.
 * `area` **is** a legal `chartSeriesKindSchema` value — the `area` → ECharts
 * `line` + `areaStyle` translation belongs to `F3.1c`'s renderer, downstream
 * of this contract. Writing `line` where `area` belongs type-checks, saves,
 * and stays invisible until `F3.1c` renders, so the mapping is asserted in
 * the spec rather than merely stated here.
 *
 * ## Per-arm point cardinality is never restated
 *
 * `WIDGET_POINT_CARDINALITY` comes from `@bms/shared`
 * (`packages/shared/src/contracts/dashboard-builder.ts:223`) — the same map
 * `apps/api`'s per-arm `pointKeys` bound reads. A gauge with two points is
 * refused here, by the same numbers the server refuses it with.
 *
 * ## View CRUD is add / edit / delete, with no rename
 *
 * Ruled by the owner (`docs/plans/f3.1e-template-dashboards-tab.md` §11
 * question 2): rename is delete-plus-add on a record, nothing asks for it,
 * and a half-applied rename drops a view. This module places no restriction
 * on it — `dashboardRowsFrom`/`buildDashboardsPayload` treat `name` as any
 * other field — the tab enforces the no-rename rule by never rendering a text
 * box over an existing row's name.
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
const CHART_SERIES_VALUES: readonly ChartSeriesKind[] = chartSeriesKindSchema.options;

/** Labels stay local — `F3.1c`'s `widget-catalog.ts` does not exist yet
 * (§5.4). This is a recorded residual for that item to fold in. */
export const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  radial_gauge: "Radial gauge",
  tank_level: "Tank level",
  value_tile: "Value tile",
  chart: "Chart",
};

/**
 * The plain label an author sees, and the contract value it writes.
 *
 * **`area` is a legal contract value, not a mistake.** The ECharts
 * translation (`area` → `line` series + `areaStyle`) is `F3.1c`'s, downstream
 * of this contract.
 */
export const CHART_SERIES_OPTIONS: readonly { label: string; value: ChartSeriesKind }[] = [
  { label: "Trend", value: "line" },
  { label: "Trend (filled)", value: "area" },
  { label: "Comparison bars", value: "bar" },
  { label: "Scatter", value: "scatter" },
];

/**
 * `contentEnvelopeSchema` caps a dashboards record at 20 views
 * (`asset-templates-content.schema.ts:147`), on the `MAX_KPI_ENTRIES`
 * precedent (`template-kpi-form.ts:48`). `apps/web` cannot import this number
 * — it is an `apps/api` local — so it is copied and pinned in the spec.
 */
export const MAX_DASHBOARD_VIEWS = 20;

/** `MAX_FEATURED_POINTS` — `asset-templates-content.schema.ts:148`. */
export const MAX_FEATURED_POINTS = 50;

/** `MAX_DASHBOARD_WIDGETS` — `asset-templates-content.schema.ts:152`. */
export const MAX_DASHBOARD_WIDGETS = 40;

/** A view name is `safeKeySchema.pipe(z.string().min(1).max(64))` —
 * `asset-templates-content.schema.ts:471`. */
export const MAX_VIEW_NAME_LENGTH = 64;

/** A widget title — `templateWidgetIdentityFields.title`,
 * `asset-templates-content.schema.ts:295`. */
const MAX_WIDGET_TITLE_LENGTH = 255;

/** `commonConfigFields.unit` — `dashboard-builder.ts:97`. */
const MAX_UNIT_LENGTH = 32;

/** `commonConfigFields.decimals` — `dashboard-builder.ts:98`. */
const MAX_DECIMALS = 6;

/** `chartConfigSchema.windowMinutes` — `dashboard-builder.ts:169`. */
const MAX_WINDOW_MINUTES = 525_600;

/** `chartConfigSchema.yAxisLabel` — `dashboard-builder.ts:171`. */
const MAX_Y_AXIS_LABEL_LENGTH = 64;

/**
 * Keys a stored view name (and, by the same rule, a newly authored one) must
 * never be. `UNSAFE_KEYS` — `asset-templates-content.schema.ts:131` /
 * `template-content-merge.ts:71`. The API refuses one of these at
 * `safeKeySchema` anyway; refusing it here too means the author is told why
 * before filling in a form, not after a 400.
 */
const UNSAFE_VIEW_NAMES = ["__proto__", "constructor", "prototype"];

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

export type TemplateDashboardWidgetRow = {
  widgetType: WidgetType;
  title: string;
  pointKeys: string[];
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  config: WidgetConfigRow;
};

export type TemplateDashboardViewRow = {
  name: string;
  featured: string[];
  widgets: TemplateDashboardWidgetRow[];
};

function blankConfigRow(): WidgetConfigRow {
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

/** A new widget of the chosen type, with defaults valid for that type. */
export function blankWidgetRow(widgetType: WidgetType): TemplateDashboardWidgetRow {
  return {
    widgetType,
    title: "",
    pointKeys: [],
    gridX: 0,
    gridY: 0,
    gridW: 4,
    gridH: 4,
    config: blankConfigRow(),
  };
}

/** A new, unnamed view. */
export function blankDashboardView(): TemplateDashboardViewRow {
  return { name: "", featured: [], widgets: [] };
}

/**
 * Reads one stored widget defensively.
 *
 * `template.content` is `z.record(z.unknown())` on the read side (Unit 6's
 * docblock), so a stored widget can be any shape at all. On the `kpiRowsFrom`
 * precedent (`template-kpi-form.ts:86`), a missing or malformed field reads
 * as an empty/safe default rather than throwing while rendering.
 */
function widgetRowFrom(raw: unknown): TemplateDashboardWidgetRow {
  const widget = (raw ?? {}) as Partial<TemplateDashboardWidget> & { config?: unknown };
  const widgetType: WidgetType = WIDGET_TYPES.includes(widget.widgetType as WidgetType)
    ? (widget.widgetType as WidgetType)
    : "value_tile";
  const config = (widget.config ?? {}) as Record<string, unknown>;
  const thresholds = Array.isArray(config.thresholds)
    ? (config.thresholds as unknown[]).map((entry): ThresholdRow => {
        const threshold = (entry ?? {}) as { value?: unknown; tone?: unknown };
        return {
          value: typeof threshold.value === "number" ? String(threshold.value) : "",
          tone: WIDGET_TONES.includes(threshold.tone as WidgetTone)
            ? (threshold.tone as WidgetTone)
            : "ok",
        };
      })
    : [];

  return {
    widgetType,
    title: typeof widget.title === "string" ? widget.title : "",
    pointKeys: Array.isArray(widget.pointKeys) ? [...widget.pointKeys] : [],
    gridX: typeof widget.gridX === "number" ? widget.gridX : 0,
    gridY: typeof widget.gridY === "number" ? widget.gridY : 0,
    gridW: typeof widget.gridW === "number" ? widget.gridW : 4,
    gridH: typeof widget.gridH === "number" ? widget.gridH : 4,
    config: {
      unit: typeof config.unit === "string" ? config.unit : "",
      decimals: typeof config.decimals === "number" ? String(config.decimals) : "",
      min: typeof config.min === "number" ? String(config.min) : "0",
      max: typeof config.max === "number" ? String(config.max) : "100",
      thresholds,
      fullScale: typeof config.fullScale === "number" ? String(config.fullScale) : "1",
      fillTone: WIDGET_TONES.includes(config.fillTone as WidgetTone)
        ? (config.fillTone as WidgetTone)
        : "",
      abbreviate: typeof config.abbreviate === "boolean" ? config.abbreviate : false,
      series: CHART_SERIES_VALUES.includes(config.series as ChartSeriesKind)
        ? (config.series as ChartSeriesKind)
        : "line",
      windowMinutes: typeof config.windowMinutes === "number" ? String(config.windowMinutes) : "",
      stacked: typeof config.stacked === "boolean" ? config.stacked : false,
      yAxisLabel: typeof config.yAxisLabel === "string" ? config.yAxisLabel : "",
    },
  };
}

/**
 * Reads the stored `content.dashboards` record into editable rows, in the
 * order `Object.keys` returns — the order the record was written in.
 */
export function dashboardRowsFrom(
  dashboards: Record<string, unknown> | undefined,
): TemplateDashboardViewRow[] {
  if (!dashboards || typeof dashboards !== "object") {
    return [];
  }
  return Object.keys(dashboards).map((name) => {
    const raw = dashboards[name];
    const view = (raw ?? {}) as Partial<TemplateDashboardView>;
    return {
      name,
      featured: Array.isArray(view.featured) ? [...view.featured] : [],
      widgets: Array.isArray(view.widgets) ? view.widgets.map(widgetRowFrom) : [],
    };
  });
}

/**
 * Moves `items[index]` one slot toward `direction`, or returns a copy
 * unchanged if that would run off either end. Used for `featured`'s move
 * up/move down affordance.
 */
export function moveArrayItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length || index < 0 || index >= items.length) {
    return [...items];
  }
  const next = [...items];
  const moved = next[index];
  next[index] = next[target];
  next[target] = moved;
  return next;
}

/** What the author must fix before a view or widget can be sent. `view`/
 * `widget` are `null` for a problem that is not about one row. */
export type DashboardFormProblem = {
  view: number | null;
  widget: number | null;
  field: string;
  message: string;
};

function widgetConfigErrors(
  viewIndex: number,
  widgetIndex: number,
  widget: TemplateDashboardWidgetRow,
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

/**
 * What the author must fix before the dashboards section can be sent.
 *
 * `declaredPointKeys` is the template's own `points[]` — the server checks
 * the same thing (`assertContentRefsResolve`) for both `featured` and every
 * widget's `pointKeys`; this names the view/widget rather than a bare
 * `content` path.
 */
export function dashboardFormErrors(
  rows: readonly TemplateDashboardViewRow[],
  declaredPointKeys: readonly string[],
): DashboardFormProblem[] {
  const problems: DashboardFormProblem[] = [];

  if (rows.length > MAX_DASHBOARD_VIEWS) {
    problems.push({
      view: null,
      widget: null,
      field: "views",
      message: `A template holds at most ${MAX_DASHBOARD_VIEWS} dashboard views. This one has ${rows.length}.`,
    });
  }

  const declared = new Set(declaredPointKeys);
  const seenNames = new Map<string, number>();

  rows.forEach((view, viewIndex) => {
    const name = view.name.trim();
    if (name === "") {
      problems.push({
        view: viewIndex,
        widget: null,
        field: "name",
        message: "A dashboard view needs a name.",
      });
    } else if (name.length > MAX_VIEW_NAME_LENGTH) {
      problems.push({
        view: viewIndex,
        widget: null,
        field: "name",
        message: `A view name is at most ${MAX_VIEW_NAME_LENGTH} characters.`,
      });
    } else if (UNSAFE_VIEW_NAMES.includes(name)) {
      problems.push({
        view: viewIndex,
        widget: null,
        field: "name",
        message: `"${name}" is not a usable view name.`,
      });
    } else {
      const first = seenNames.get(name);
      if (first !== undefined) {
        problems.push({
          view: viewIndex,
          widget: null,
          field: "name",
          message: `"${name}" is already used by view ${first + 1}. Each name appears once.`,
        });
      } else {
        seenNames.set(name, viewIndex);
      }
    }

    if (view.featured.length === 0) {
      problems.push({
        view: viewIndex,
        widget: null,
        field: "featured",
        message:
          "A dashboard view needs at least one featured point — a widgets-only view cannot be saved.",
      });
    } else if (view.featured.length > MAX_FEATURED_POINTS) {
      problems.push({
        view: viewIndex,
        widget: null,
        field: "featured",
        message: `A view features at most ${MAX_FEATURED_POINTS} points.`,
      });
    }
    for (const key of view.featured) {
      if (!declared.has(key)) {
        problems.push({
          view: viewIndex,
          widget: null,
          field: "featured",
          message: `"${key}" is not a point this template declares.`,
        });
      }
    }

    if (view.widgets.length > MAX_DASHBOARD_WIDGETS) {
      problems.push({
        view: viewIndex,
        widget: null,
        field: "widgets",
        message: `A view holds at most ${MAX_DASHBOARD_WIDGETS} widgets. This one has ${view.widgets.length}.`,
      });
    }

    view.widgets.forEach((widget, widgetIndex) => {
      const cardinality = WIDGET_POINT_CARDINALITY[widget.widgetType];
      if (widget.pointKeys.length < cardinality.min || widget.pointKeys.length > cardinality.max) {
        problems.push({
          view: viewIndex,
          widget: widgetIndex,
          field: "pointKeys",
          message:
            cardinality.min === cardinality.max
              ? `A ${WIDGET_TYPE_LABELS[widget.widgetType]} widget binds exactly ${cardinality.min} point${
                  cardinality.min === 1 ? "" : "s"
                }.`
              : `A ${WIDGET_TYPE_LABELS[widget.widgetType]} widget binds ${cardinality.min}-${cardinality.max} points.`,
        });
      }
      for (const key of widget.pointKeys) {
        if (!declared.has(key)) {
          problems.push({
            view: viewIndex,
            widget: widgetIndex,
            field: "pointKeys",
            message: `"${key}" is not a point this template declares.`,
          });
        }
      }

      if (widget.title.trim().length > MAX_WIDGET_TITLE_LENGTH) {
        problems.push({
          view: viewIndex,
          widget: widgetIndex,
          field: "title",
          message: `A widget title is at most ${MAX_WIDGET_TITLE_LENGTH} characters.`,
        });
      }
      if (!Number.isInteger(widget.gridX) || widget.gridX < 0 || widget.gridX > 11) {
        problems.push({
          view: viewIndex,
          widget: widgetIndex,
          field: "gridX",
          message: "gridX must be an integer from 0 to 11.",
        });
      }
      if (!Number.isInteger(widget.gridY) || widget.gridY < 0) {
        problems.push({
          view: viewIndex,
          widget: widgetIndex,
          field: "gridY",
          message: "gridY must be an integer of at least 0.",
        });
      }
      if (!Number.isInteger(widget.gridW) || widget.gridW < 1 || widget.gridW > 12) {
        problems.push({
          view: viewIndex,
          widget: widgetIndex,
          field: "gridW",
          message: "gridW must be an integer from 1 to 12.",
        });
      }
      if (!Number.isInteger(widget.gridH) || widget.gridH < 1 || widget.gridH > 24) {
        problems.push({
          view: viewIndex,
          widget: widgetIndex,
          field: "gridH",
          message: "gridH must be an integer from 1 to 24.",
        });
      }
      if (widget.gridX + widget.gridW > 12) {
        problems.push({
          view: viewIndex,
          widget: widgetIndex,
          field: "gridW",
          message: "a widget must fit inside the 12-column canvas.",
        });
      }

      problems.push(...widgetConfigErrors(viewIndex, widgetIndex, widget));
    });
  });

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

function buildGaugeConfig(config: WidgetConfigRow): GaugeConfig {
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

function buildTankConfig(config: WidgetConfigRow): TankConfig {
  const out: TankConfig = {
    ...buildCommonConfig(config),
    fullScale: Number(config.fullScale),
  };
  if (config.fillTone !== "") {
    out.fillTone = config.fillTone;
  }
  return out;
}

function buildTileConfig(config: WidgetConfigRow): TileConfig {
  const out: TileConfig = { ...buildCommonConfig(config) };
  if (config.abbreviate) {
    out.abbreviate = true;
  }
  return out;
}

function buildChartConfig(config: WidgetConfigRow): ChartConfig {
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

function buildWidgetPayload(row: TemplateDashboardWidgetRow): TemplateDashboardWidget {
  const identity: Omit<TemplateDashboardWidget, keyof DashboardWidgetSpec> = {
    pointKeys: [...row.pointKeys],
    gridX: row.gridX,
    gridY: row.gridY,
    gridW: row.gridW,
    gridH: row.gridH,
  };
  const title = row.title.trim();
  if (title !== "") {
    identity.title = title;
  }

  switch (row.widgetType) {
    case "radial_gauge":
      return { ...identity, widgetType: "radial_gauge", config: buildGaugeConfig(row.config) };
    case "tank_level":
      return { ...identity, widgetType: "tank_level", config: buildTankConfig(row.config) };
    case "value_tile":
      return { ...identity, widgetType: "value_tile", config: buildTileConfig(row.config) };
    case "chart":
      return { ...identity, widgetType: "chart", config: buildChartConfig(row.config) };
  }
}

/**
 * The `content.dashboards` payload — **always the complete record**.
 *
 * `mergeTemplateContent` replaces the whole `dashboards` key, so a caller
 * must never build this from a subset of `rows`. A row whose name is blank or
 * unsafe is dropped rather than sent — `dashboardFormErrors` blocks Save in
 * that state, so a build that reaches the wire never carries one.
 */
export function buildDashboardsPayload(
  rows: readonly TemplateDashboardViewRow[],
): Record<string, TemplateDashboardView> {
  const payload: Record<string, TemplateDashboardView> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name === "" || UNSAFE_VIEW_NAMES.includes(name)) {
      continue;
    }
    const view: TemplateDashboardView = { featured: [...row.featured] };
    if (row.widgets.length > 0) {
      view.widgets = row.widgets.map(buildWidgetPayload);
    }
    payload[name] = view;
  }
  return payload;
}

/** Whether the rows differ from what is stored, compared as they would be
 * sent — the `kpisHaveChanged` shape (`template-kpi-form.ts:303`). */
export function dashboardsHaveChanged(
  rows: readonly TemplateDashboardViewRow[],
  stored: Record<string, unknown> | undefined,
): boolean {
  return (
    JSON.stringify(buildDashboardsPayload(rows)) !==
    JSON.stringify(buildDashboardsPayload(dashboardRowsFrom(stored)))
  );
}
