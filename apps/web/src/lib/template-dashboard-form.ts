import { DASHBOARD_GRID, WIDGET_POINT_CARDINALITY } from "@bms/shared";
import type {
  ChartSeriesKind,
  DashboardWidgetSpec,
  TemplateDashboardView,
  PointAggregateFunction,
  TemplateDashboardWidget,
  WidgetIcon,
  WidgetType,
} from "@bms/shared";
import {
  AGGREGATE_FUNCTIONS,
  CHART_SERIES_OPTIONS,
  CHART_SERIES_VALUES,
  MAX_WIDGET_TITLE_LENGTH,
  WIDGET_ICONS,
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
import type { ThresholdRow, WidgetConfigRow, WidgetTone } from "./widget-config-form";

/**
 * Re-exported for this module's own external consumers
 * (`dashboard-widget-editor.tsx`), which imported these from this file
 * before `F3.1d` Unit 1 moved their declaration to `widget-config-form.ts`.
 */
export { CHART_SERIES_OPTIONS, WIDGET_TONES, WIDGET_TYPE_LABELS, WIDGET_TYPES };
export type { WidgetConfigRow };

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

/**
 * Keys a stored view name (and, by the same rule, a newly authored one) must
 * never be. `UNSAFE_KEYS` — `asset-templates-content.schema.ts:131` /
 * `template-content-merge.ts:71`. The API refuses one of these at
 * `safeKeySchema` anyway; refusing it here too means the author is told why
 * before filling in a form, not after a 400.
 */
const UNSAFE_VIEW_NAMES = ["__proto__", "constructor", "prototype"];

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
      // `F3.35` — every field `buildTileConfig`/`buildChartConfig` writes must
      // be read back, or an edit-and-resave silently erases it. Guarded per
      // field with a `typeof`/membership check because this reads an
      // **unvalidated** `z.record(z.unknown())` blob, unlike
      // `dashboard-builder-form.ts`'s already-parsed DTO.
      //
      // `aggregate` is stored under one key for both widget types and split
      // into two row fields here, because one flat row serves all four types
      // and the tile's and the chart's mean different things.
      aggregate: AGGREGATE_FUNCTIONS.includes(config.aggregate as PointAggregateFunction)
        ? (config.aggregate as PointAggregateFunction)
        : "",
      compareToPrevious:
        typeof config.compareToPrevious === "boolean" ? config.compareToPrevious : false,
      icon: WIDGET_ICONS.includes(config.icon as WidgetIcon) ? (config.icon as WidgetIcon) : "",
      hint: typeof config.hint === "string" ? config.hint : "",
      tone: WIDGET_TONES.includes(config.tone as WidgetTone) ? (config.tone as WidgetTone) : "",
      series: CHART_SERIES_VALUES.includes(config.series as ChartSeriesKind)
        ? (config.series as ChartSeriesKind)
        : "line",
      windowMinutes: typeof config.windowMinutes === "number" ? String(config.windowMinutes) : "",
      stacked: typeof config.stacked === "boolean" ? config.stacked : false,
      yAxisLabel: typeof config.yAxisLabel === "string" ? config.yAxisLabel : "",
      chartAggregate: AGGREGATE_FUNCTIONS.includes(config.aggregate as PointAggregateFunction)
        ? (config.aggregate as PointAggregateFunction)
        : "",
      footerStats: typeof config.footerStats === "boolean" ? config.footerStats : false,
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
      // **A template widget's minimum is its own, and it is deliberately not the live one.**
      //
      // `F3.35` Stage C lowered `WIDGET_POINT_CARDINALITY.value_tile.min` to 0, because ADR
      // 0048 decision 2 lets a live tile bind a named metric instead of a point. **That
      // relaxation must not reach this surface.** A template widget binds point *keys* against
      // an unresolved catalog, and a catalog entry is not resolvable at instantiation — it is
      // a SQL query over one organization's operational tables, which a template does not have
      // and cannot name. So a template tile with no point key would instantiate into a live
      // widget that binds nothing at all, which the live builder itself refuses.
      //
      // The maximum still comes from the shared record: a template must never author more
      // bindings than the live widget accepts. Only the floor is local, and only for the tile.
      const shared = WIDGET_POINT_CARDINALITY[widget.widgetType];
      const cardinality = { min: Math.max(shared.min, 1), max: shared.max };
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
      if (
        !Number.isInteger(widget.gridX) ||
        widget.gridX < 0 ||
        widget.gridX > DASHBOARD_GRID.columns - 1
      ) {
        problems.push({
          view: viewIndex,
          widget: widgetIndex,
          field: "gridX",
          message: `gridX must be an integer from 0 to ${DASHBOARD_GRID.columns - 1}.`,
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
      if (
        !Number.isInteger(widget.gridW) ||
        widget.gridW < DASHBOARD_GRID.minWidgetW ||
        widget.gridW > DASHBOARD_GRID.columns
      ) {
        problems.push({
          view: viewIndex,
          widget: widgetIndex,
          field: "gridW",
          message: `gridW must be an integer from ${DASHBOARD_GRID.minWidgetW} to ${DASHBOARD_GRID.columns}.`,
        });
      }
      if (
        !Number.isInteger(widget.gridH) ||
        widget.gridH < DASHBOARD_GRID.minWidgetH ||
        widget.gridH > DASHBOARD_GRID.maxWidgetH
      ) {
        problems.push({
          view: viewIndex,
          widget: widgetIndex,
          field: "gridH",
          message: `gridH must be an integer from ${DASHBOARD_GRID.minWidgetH} to ${DASHBOARD_GRID.maxWidgetH}.`,
        });
      }
      if (widget.gridX + widget.gridW > DASHBOARD_GRID.columns) {
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
