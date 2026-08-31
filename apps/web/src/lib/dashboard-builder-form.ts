import {
  bindingExclusiveMessage,
  bindingRequiredMessage,
  DASHBOARD_GRID,
  MAX_DASHBOARD_WIDGETS,
} from "@bms/shared";
import type {
  DashboardDto,
  DashboardWidgetDto,
  DashboardWidgetPointDto,
  DashboardWidgetSpec,
  MetricCatalogKey,
  WidgetPointRole,
  WidgetType,
} from "@bms/shared";

import { WIDGET_CATALOG } from "./widget-catalog";
import {
  MAX_WIDGET_TITLE_LENGTH,
  blankConfigRow,
  buildChartConfig,
  buildGaugeConfig,
  buildTankConfig,
  buildTileConfig,
  widgetConfigErrors,
  type WidgetConfigRow,
} from "./widget-config-form";

/**
 * The live dashboard builder's row model (`F3.1d` Unit 4). Not a restatement of
 * `template-dashboard-form.ts`'s `TemplateDashboardWidgetRow` — a live widget binds `pointId`s
 * to a resolved organization (§7), where a template widget declares `pointKeys` against its own
 * unresolved catalog — but it edits the SAME four `DashboardWidgetSpec["config"]` shapes, so the
 * config half is imported from `widget-config-form.ts` (Unit 1) rather than restated.
 */

/**
 * One point binding, as edited. `label` is a **display-only** string for the widget inspector
 * (Unit 7) — derived from `pointKey`/`unit`, the only human-readable fields
 * `dashboardWidgetPointDtoSchema` carries — and is dropped by `buildPutWidgetsPayload` below,
 * which sends only `{pointId, role, sortOrder}`. A reader who finds `label` on the row and not
 * in the write payload should read this note before assuming it is a bug.
 */
export type DashboardWidgetPointRow = {
  pointId: string;
  role: WidgetPointRole;
  sortOrder: number;
  label: string;
};

/**
 * One widget, as edited. `id` is present when the row came from the server and absent for a
 * widget the author just added — `PutDashboardWidgetsBody`'s own `id` field is optional for
 * exactly this reason, so an id survives a re-save and a new widget does not need to invent one.
 */
export type DashboardWidgetRow = {
  id?: string;
  widgetType: WidgetType;
  title: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  points: DashboardWidgetPointRow[];
  /**
   * `F3.35` Stage C — the catalog bindings on this widget. Present from the moment the tile
   * gained a second binding kind, so `dashboardBuilderErrors` can enforce *exactly one kind*.
   * The picker that fills it is Stage C's Unit 7; validating a binding the builder cannot yet
   * author is deliberate — the alternative is a builder that accepts a tile binding nothing.
   */
  sources: DashboardWidgetSourceRow[];
  config: WidgetConfigRow;
};

/** One catalog binding as the builder holds it. `params` stays a plain record — the per-entry
    shape is the API's `.strict()` schema, and restating it here would be a second declaration
    of a vocabulary §4.8 says is declared once. */
export type DashboardWidgetSourceRow = {
  catalogKey: MetricCatalogKey;
  params: Record<string, string | number | boolean>;
};

/** The whole widget set, ready for `PUT /dashboards/:id/widgets`. Declared locally rather than
 * imported from `apps/api` — `apps/web` does not and must not depend on `apps/api` — but it
 * mirrors `PutDashboardWidgetsBody` (`apps/api/src/dashboard-builder/dashboards.schema.ts`)
 * field for field, the same way `rules.ts`'s `RuleDraftPayload` mirrors its own request body
 * rather than importing it. */
export type PointWritePayload = {
  pointId: string;
  role: WidgetPointRole;
  sortOrder: number;
};

/** `F3.35` Stage C — one catalog binding as submitted. `sortOrder` is assigned from the row's
    position rather than carried, the way the point payload derives its own. */
export type SourceWritePayload = {
  catalogKey: MetricCatalogKey;
  params: Record<string, string | number | boolean>;
  sortOrder: number;
};

type WidgetIdentityWritePayload = {
  id?: string;
  title?: string | null;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  points: PointWritePayload[];
  sources: SourceWritePayload[];
};

export type WidgetWritePayload = WidgetIdentityWritePayload & DashboardWidgetSpec;

export type PutDashboardWidgetsPayload = {
  widgets: WidgetWritePayload[];
};

/** A new widget of the chosen type, sized from the catalog's own default — never a restated
 * literal (`WIDGET_CATALOG[type].defaultSize`, which itself derives `points` from
 * `WIDGET_POINT_CARDINALITY`, per Amendment 2 §1). */
export function blankDashboardWidgetRow(widgetType: WidgetType): DashboardWidgetRow {
  const { w, h } = WIDGET_CATALOG[widgetType].defaultSize;
  return {
    widgetType,
    title: "",
    gridX: 0,
    gridY: 0,
    gridW: w,
    gridH: h,
    points: [],
    sources: [],
    config: blankConfigRow(),
  };
}

/** A display label for an already-bound point — `pointKey` alone, or `pointKey (unit)` when a
 * unit is stored. Not a name lookup: the DTO carries no asset name, and a second round trip to
 * fetch one is the request-volume growth plan §15 Q4 already declined for this row. */
function pointBindingLabel(point: DashboardWidgetPointDto): string {
  return point.unit ? `${point.pointKey} (${point.unit})` : point.pointKey;
}

/** The reverse of `buildGaugeConfig`/`buildTankConfig`/`buildTileConfig`/`buildChartConfig` —
 * an already-validated `DashboardWidgetDto` (unlike `template-dashboard-form.ts`'s
 * `widgetRowFrom`, which reads an unvalidated `z.record(z.unknown())` blob) narrows through the
 * `switch` on `widget.widgetType` the same way `DashboardWidget`'s own dispatcher does. */
function configRowFromDto(widget: DashboardWidgetDto): WidgetConfigRow {
  const row = blankConfigRow();
  row.unit = widget.config.unit ?? "";
  row.decimals = widget.config.decimals !== undefined ? String(widget.config.decimals) : "";

  switch (widget.widgetType) {
    case "radial_gauge":
      row.min = String(widget.config.min);
      row.max = String(widget.config.max);
      row.thresholds = (widget.config.thresholds ?? []).map((threshold) => ({
        value: String(threshold.value),
        tone: threshold.tone,
      }));
      break;
    case "tank_level":
      row.fullScale = String(widget.config.fullScale);
      row.fillTone = widget.config.fillTone ?? "";
      break;
    case "value_tile":
      row.abbreviate = widget.config.abbreviate ?? false;
      // `F3.35` — a field read by `buildTileConfig` and NOT read back here is
      // silently destroyed on every edit-and-resave: the author opens a
      // configured tile, changes its title, saves, and the aggregate is gone
      // with no error anywhere. The round-trip assertion in the spec is what
      // holds these two lists equal.
      row.aggregate = widget.config.aggregate ?? "";
      row.windowMinutes =
        widget.config.windowMinutes !== undefined ? String(widget.config.windowMinutes) : "";
      row.compareToPrevious = widget.config.compareToPrevious ?? false;
      row.icon = widget.config.icon ?? "";
      row.hint = widget.config.hint ?? "";
      row.tone = widget.config.tone ?? "";
      break;
    case "chart":
      row.series = widget.config.series;
      row.windowMinutes =
        widget.config.windowMinutes !== undefined ? String(widget.config.windowMinutes) : "";
      row.stacked = widget.config.stacked ?? false;
      row.yAxisLabel = widget.config.yAxisLabel ?? "";
      row.chartAggregate = widget.config.aggregate ?? "";
      row.footerStats = widget.config.footerStats ?? false;
      break;
  }
  return row;
}

/** Reads a dashboard's stored widgets into editable rows, preserving each widget's own `id`
 * so a re-save can key on it (`PutDashboardWidgetsBody.id`'s own reason for being optional). */
export function dashboardRowsFromDto(dto: DashboardDto): DashboardWidgetRow[] {
  return dto.widgets.map((widget) => ({
    id: widget.id,
    widgetType: widget.widgetType,
    title: widget.title ?? "",
    gridX: widget.gridX,
    gridY: widget.gridY,
    gridW: widget.gridW,
    gridH: widget.gridH,
    points: widget.points.map((point) => ({
      pointId: point.pointId,
      role: point.role,
      sortOrder: point.sortOrder,
      label: pointBindingLabel(point),
    })),
    // `F3.35` Stage C. Carried through so a re-save preserves a binding this builder version
    // cannot yet author — dropping it here would silently delete the author's metric on the
    // next save of an unrelated field.
    sources: widget.sources.map((source) => ({
      catalogKey: source.catalogKey,
      params: source.params,
    })),
    config: configRowFromDto(widget),
  }));
}

/** What the author must fix before the widget set can be saved. `widget` is `null` for a
 * problem about the set as a whole (too many widgets). */
export type DashboardBuilderProblem = {
  widget: number | null;
  field: string;
  message: string;
};

/**
 * Review finding — `WidgetInspector` renders only the SELECTED widget's problems
 * (`problems.filter((p) => p.widget === selected)`), so a set-level problem (`widget: null`)
 * and any OTHER widget's problem render nowhere at all: `Save` goes disabled, the page says
 * "Fix the problems above to save", and nothing above shows a problem. This is what a
 * page-level summary must show — every problem `WidgetInspector`'s current selection does not.
 */
export function unselectedDashboardBuilderProblems(
  problems: readonly DashboardBuilderProblem[],
  selected: number | null,
): DashboardBuilderProblem[] {
  return problems.filter((problem) => selected === null || problem.widget !== selected);
}

/** A human-readable subject for a problem — "Dashboard" for a set-level one (`widget: null`),
 * or the widget's own title/catalog label otherwise, so a summary entry names what it is about
 * without the reader having to count tiles on the canvas. */
export function dashboardBuilderProblemSubject(
  rows: readonly DashboardWidgetRow[],
  problem: DashboardBuilderProblem,
): string {
  if (problem.widget === null) {
    return "Dashboard";
  }
  const row = rows[problem.widget];
  if (!row) {
    return `Widget ${problem.widget + 1}`;
  }
  const label = row.title.trim() || WIDGET_CATALOG[row.widgetType].label;
  return `Widget ${problem.widget + 1} (${label})`;
}

/**
 * Validates the whole widget set before `PUT /dashboards/:id/widgets` is attempted.
 *
 * Cardinality is read from `WIDGET_CATALOG[type].points` — never a literal — so this cannot
 * drift from the number `F3.1b`'s write path and `F3.1c`'s renderer also read (Amendment 2 §1).
 * The grid checks read `DASHBOARD_GRID` for the same reason; `min` is enforced here as an
 * AUTHORING rule only — a widget already saved below `min` (a retired sensor took it there)
 * is not re-validated by this function against a stored dashboard, only against edits in
 * progress, per `WIDGET_POINT_CARDINALITY`'s own "min is an authoring rule and never a read
 * rule" comment.
 */
export function dashboardBuilderErrors(rows: readonly DashboardWidgetRow[]): DashboardBuilderProblem[] {
  const problems: DashboardBuilderProblem[] = [];
  const push = (widget: number | null, field: string, message: string): void => {
    problems.push({ widget, field, message });
  };

  if (rows.length > MAX_DASHBOARD_WIDGETS) {
    push(
      null,
      "widgets",
      `A dashboard holds at most ${MAX_DASHBOARD_WIDGETS} widgets. This one has ${rows.length}.`,
    );
  }

  rows.forEach((row, index) => {
    if (row.title.trim().length > MAX_WIDGET_TITLE_LENGTH) {
      push(index, "title", `A widget title is at most ${MAX_WIDGET_TITLE_LENGTH} characters.`);
    }

    const label = WIDGET_CATALOG[row.widgetType].label;
    const cardinality = WIDGET_CATALOG[row.widgetType].points;
    if (row.points.length < cardinality.min || row.points.length > cardinality.max) {
      const need =
        cardinality.min === cardinality.max
          ? `exactly ${cardinality.min} bound point(s)`
          : `between ${cardinality.min} and ${cardinality.max} bound point(s)`;
      push(index, "points", `A ${label} widget needs ${need}. This one has ${row.points.length}.`);
    }

    // `F3.35` Stage C. The same bound, one binding kind over.
    const sourceCardinality = WIDGET_CATALOG[row.widgetType].sources;
    if (row.sources.length > sourceCardinality.max) {
      push(
        index,
        "points",
        sourceCardinality.max === 0
          ? `A ${label} widget binds no named metric. This one has ${row.sources.length}.`
          : `A ${label} widget binds at most ${sourceCardinality.max} named metric(s). This one has ${row.sources.length}.`,
      );
    }

    // **The rule that replaced `WIDGET_POINT_CARDINALITY.value_tile.min === 1`.**
    //
    // ADR 0048 decision 2 gives the tile a second binding kind, so "binds at least one point"
    // stopped being the same sentence as "binds something" and the per-type minimum could no
    // longer carry it: a minimum is a bound on one array, and this is a relation between two.
    // Its API twin is `eachWidgetBindsExactlyOneKind`, on the widgets array rather than on a
    // `z.discriminatedUnion` arm, for the same reason.
    //
    // Both halves matter. **Neither** kind bound is the state the old minimum used to refuse —
    // a widget that saves, loads and draws an empty rectangle. **Both** kinds bound is the new
    // one: a tile with a point and a metric has two answers for one number, and picking either
    // silently would put a number on screen that the author did not choose.
    //
    // The text comes from `@bms/shared`, not from here. `putDashboardWidgetsBodySchema` states
    // the same rule and answers a 400 with the same template, so an author who bypasses this
    // form reads one problem rather than two — see the messages' own docblock.
    if (row.points.length === 0 && row.sources.length === 0) {
      push(index, "points", bindingRequiredMessage(label));
    }
    if (row.points.length > 0 && row.sources.length > 0) {
      push(index, "points", bindingExclusiveMessage(label));
    }

    if (row.gridW < DASHBOARD_GRID.minWidgetW || row.gridW > DASHBOARD_GRID.columns) {
      push(index, "gridW", "This widget's width does not fit the canvas.");
    }
    if (row.gridH < DASHBOARD_GRID.minWidgetH || row.gridH > DASHBOARD_GRID.maxWidgetH) {
      push(index, "gridH", "This widget's height does not fit the canvas.");
    }
    if (row.gridX + row.gridW > DASHBOARD_GRID.columns) {
      push(index, "gridW", `A widget must fit inside the ${DASHBOARD_GRID.columns}-column canvas.`);
    }

    for (const problem of widgetConfigErrors(0, index, { widgetType: row.widgetType, config: row.config })) {
      push(index, problem.field, problem.message);
    }
  });

  return problems;
}

function buildIdentity(row: DashboardWidgetRow): WidgetIdentityWritePayload {
  const identity: WidgetIdentityWritePayload = {
    gridX: row.gridX,
    gridY: row.gridY,
    gridW: row.gridW,
    gridH: row.gridH,
    points: row.points.map((point) => ({
      pointId: point.pointId,
      role: point.role,
      sortOrder: point.sortOrder,
    })),
    sources: row.sources.map((source, order) => ({
      catalogKey: source.catalogKey,
      params: source.params,
      sortOrder: order,
    })),
  };
  if (row.id !== undefined) {
    identity.id = row.id;
  }
  const title = row.title.trim();
  if (title !== "") {
    identity.title = title;
  }
  return identity;
}

/** Builds the whole `PUT /dashboards/:id/widgets` body — `buildWidgetPayload`'s shape in
 * `template-dashboard-form.ts`, over the live widget's richer `points` array instead of
 * `pointKeys`. */
export function buildPutWidgetsPayload(rows: readonly DashboardWidgetRow[]): PutDashboardWidgetsPayload {
  return {
    widgets: rows.map((row): WidgetWritePayload => {
      const identity = buildIdentity(row);
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
    }),
  };
}

/** Whether the builder holds unsaved edits — compares the current rows against the dashboard's
 * own stored widgets, re-read through `dashboardRowsFromDto` so both sides are the same shape.
 * Deliberately does NOT normalize point order before comparing: `sortOrder` is a stored,
 * meaningful value a chart's legend order depends on, so an author's reorder is a real change
 * and must report `true` — normalizing it away would silently discard the edit on Save. */
export function builderHasChanged(rows: readonly DashboardWidgetRow[], dto: DashboardDto): boolean {
  return JSON.stringify(rows) !== JSON.stringify(dashboardRowsFromDto(dto));
}
