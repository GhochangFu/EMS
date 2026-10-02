import {
  MIMIC_TAB_MESSAGE,
  bindingExclusiveMessage,
  bindingRequiredMessage,
  DASHBOARD_GRID,
  dashboardTabKeySchema,
  MAX_DASHBOARD_TABS,
  MAX_DASHBOARD_WIDGETS,
  mimicPresetSchema,
  RESERVED_DASHBOARD_TAB_KEYS,
  widgetTypeBindsNothing,
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

import type { DashboardScopeValue } from "./dashboard-scope";
import { WIDGET_CATALOG } from "./widget-catalog";
import {
  MAX_WIDGET_TITLE_LENGTH,
  WIDGET_TYPES,
  blankConfigRow,
  buildActiveAlarmsRailConfig,
  buildChartConfig,
  buildMimicConfig,
  buildModuleSummaryCardConfig,
  buildTableConfig,
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
 * (Unit 7) — `pointKey (unit)`, deliberately NOT the asset-qualified `seriesNameFor` the legend
 * uses (ADR 0069 Q4): the picker row carries no `assetCode`, so a freshly picked point and a
 * loaded one would read differently until the next save. It is dropped by `buildPutWidgetsPayload`
 * below, which sends only `{pointId, role, sortOrder}`. A reader who finds `label` on the row and
 * not in the write payload should read this note before assuming it is a bug.
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
   * The picker that fills it shipped in Stage C's Unit 6 (`metric-source-picker.tsx`). This
   * field was validated one unit before the builder could author it, deliberately — the
   * alternative was a builder that accepts a tile binding nothing.
   */
  sources: DashboardWidgetSourceRow[];
  /** `F3.73` D11 — the key of the tab this widget sits on; absent on a legacy (tab-less) canvas
   * and on a widget in no tab. Read from `widget.tabId` through the dashboard's own `tabs`. */
  tabKey?: string;
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

/** `F3.73` D2 — one tab as submitted. `id` is present for a stored tab (kept by the API's diff)
 * and absent for a new one — or for a duplicate's copy, which must not name the source's tab. */
export type TabWritePayload = {
  id?: string;
  key: string;
  label: string;
  sortOrder: number;
  assetGroupId: string | null;
};

/** The stored tabs as a write set, ids kept — what a save that edits no tab re-sends, so the
 * API's diff keeps them rather than deleting every tab. */
export function tabWritesFromDto(tabs: DashboardDto["tabs"]): TabWritePayload[] {
  return tabs.map((tab) => ({
    id: tab.id,
    key: tab.key,
    label: tab.label,
    sortOrder: tab.sortOrder,
    assetGroupId: tab.assetGroupId,
  }));
}

type WidgetIdentityWritePayload = {
  id?: string;
  tabKey?: string;
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
  tabs: TabWritePayload[];
  widgets: WidgetWritePayload[];
};

/** A new widget of the chosen type, sized from the catalog's own default — never a restated
 * literal (`WIDGET_CATALOG[type].defaultSize`, which itself derives `points` from
 * `WIDGET_POINT_CARDINALITY`, per Amendment 2 §1). */
export function blankDashboardWidgetRow(widgetType: WidgetType): DashboardWidgetRow {
  const { w, h } = WIDGET_CATALOG[widgetType].defaultSize;
  const config = blankConfigRow();
  if (widgetType === "mimic") {
    // `F3.32` — v1 has one preset, so a new mimic starts on it rather than on a select the
    // author must touch before the first save. `blankConfigRow` keeps `""` for the reason its
    // own field comment gives.
    config.mimicPreset = mimicPresetSchema.options[0];
    // `F3.32c` (ADR 0081) — the source select defaults to Preset, keeping a freshly added mimic's
    // behaviour unchanged from before the layout arm existed.
    config.mimicSource = "preset";
  }
  if (widgetType === "active_alarms_rail") {
    // `F3.73` — the contract's own defaults, so a fresh rail saves as the schema would default it.
    config.railRows = "8";
    config.railShowSummary = true;
  }
  return {
    widgetType,
    title: "",
    gridX: 0,
    gridY: 0,
    gridW: w,
    gridH: h,
    points: [],
    sources: [],
    config,
  };
}

/**
 * The widget types the builder offers on a dashboard of this scope kind (`F3.32`, ADR 0079
 * decision 6).
 *
 * The plant mimic resolves each node at read time from the dashboard's asset group by role, so it
 * is offered only on an `assetGroup` dashboard; the API refuses it on every other scope with a 400
 * (`needsAssetGroup`). **`F3.73`: not derived from `widgetTypeBindsNothing` any more.** The five
 * site widgets bind nothing too, but they read the dashboard's own scope (plan D9), so they are
 * offered on every scope kind — the API's `mimicGroupFor` rule names the mimic alone.
 *
 * Takes the scope KIND from the form's live state, not the stored DTO, so switching an edited
 * dashboard away from its group removes the button at once.
 */
export function offerableWidgetTypes(kind: DashboardScopeValue["kind"]): readonly WidgetType[] {
  return WIDGET_TYPES.filter((type) => kind === "assetGroup" || !needsAssetGroup(type));
}

/**
 * `F3.73` D11 — the widget types the edit page offers on the SELECTED tab. A mimic on a tab that
 * binds a group resolves against that group (the API's `mimicGroupFor`), so such a tab offers it
 * whatever the scope kind; `tab` is `undefined` on a dashboard without tabs.
 */
export function offerableWidgetTypesOnTab(
  kind: DashboardScopeValue["kind"],
  tab: TabForRules | undefined,
  // `F3.74` — REQUIRED: the dashboard's whole tab set. A mimic on a group-less tab resolves through
  // `config.tabKey`, so it is offered whenever some tab binds a group; an omitted list would hide it.
  tabs: readonly TabForRules[],
): readonly WidgetType[] {
  const resolves = tab !== undefined && (tab.assetGroupId !== null || tabs.some((other) => other.assetGroupId !== null));
  return offerableWidgetTypes(resolves ? "assetGroup" : kind);
}

/** Whether a widget type resolves against an asset group — the plant mimic alone (see above). */
function needsAssetGroup(type: WidgetType): boolean {
  return type === "mimic";
}

/** A display label for an already-bound point — `pointKey` alone, or `pointKey (unit)` when a
 * unit is stored. The DTO carries `assetCode` since ADR 0069, and the legend uses it; this label
 * does not (Q4), so it matches `addPoint`'s label for a freshly picked point, whose picker row has
 * no code. Still not a name lookup — a second round trip is what plan §15 Q4 declined. */
function pointBindingLabel(point: DashboardWidgetPointDto): string {
  return point.unit ? `${point.pointKey} (${point.unit})` : point.pointKey;
}

/** The reverse of `buildGaugeConfig`/`buildTankConfig`/`buildTileConfig`/`buildChartConfig` —
 * an already-validated `DashboardWidgetDto` (unlike `template-dashboard-form.ts`'s
 * `widgetRowFrom`, which reads an unvalidated `z.record(z.unknown())` blob) narrows through the
 * `switch` on `widget.widgetType` the same way `DashboardWidget`'s own dispatcher does. */
function configRowFromDto(widget: DashboardWidgetDto): WidgetConfigRow {
  const row = blankConfigRow();
  // `F3.32` / plan D8 — `mimicConfigSchema` carries neither field, so the generic read is guarded.
  if ("unit" in widget.config) {
    row.unit = widget.config.unit ?? "";
  }
  if ("decimals" in widget.config) {
    row.decimals = widget.config.decimals !== undefined ? String(widget.config.decimals) : "";
  }

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
    case "table":
      // `F3.35` Stage B, and it is here for the reason the `value_tile` arm above states: a
      // field `buildTableConfig` writes and this switch does not read back is destroyed on
      // every edit-and-resave. An author picks four columns, later renames the widget, saves,
      // and the card silently widens to every column with nothing reporting it.
      //
      // `?? []` collapses absent to empty, which is the same state — `tableConfigSchema`'s
      // docblock rules that both mean "every declared column", and `buildTableConfig` writes
      // only the absent form back, so the round trip is stable rather than merely lossless.
      row.tableColumns = [...(widget.config.columns ?? [])];
      break;
    case "mimic":
      // `F3.32` — the same edit-and-resave reason as the two arms above. Without this arm the
      // row holds no preset/layout, `widgetConfigErrors` blocks the save, and the stored choice
      // is lost to the form.
      //
      // `F3.32c` (ADR 0081) — `widget.config` is now a union on `source`; narrow it before
      // reading either arm's own field, rather than reading `.preset` off the union type.
      if (widget.config.source === "layout") {
        row.mimicSource = "layout";
        row.mimicLayoutId = widget.config.layoutId;
      } else {
        row.mimicSource = "preset";
        row.mimicPreset = widget.config.preset;
        // `F3.74` — `compact` is the preset arm's only; stored `false` and absent both read as unset.
        if (widget.config.compact === true) {
          row.mimicCompact = true;
        }
      }
      if (widget.config.tabKey !== undefined) {
        row.mimicTabKey = widget.config.tabKey;
      }
      break;
    case "active_alarms_rail":
      // `F3.73` — the same edit-and-resave reason as the arms above: a field `buildActiveAlarmsRailConfig`
      // writes and this switch does not read back is lost on the next save.
      row.railRows = String(widget.config.rows);
      row.railShowSummary = widget.config.showSummary;
      break;
    case "module_summary_card":
      row.targetTabKey = widget.config.targetTabKey;
      break;
    case "state_legend":
    case "asset_class_strip":
    case "critical_systems_list":
      // `F3.73` — configure nothing (`{}`); named so the `never` below still proves no arm is forgotten.
      break;
    default: {
      // No arm may be forgotten: this switch has no compile-time exhaustiveness otherwise, and a
      // missing arm is silent data loss on the next save rather than an error.
      const unreachable: never = widget;
      throw new Error(`Unhandled widget type ${JSON.stringify(unreachable)}`);
    }
  }
  return row;
}

/** Reads a dashboard's stored widgets into editable rows, preserving each widget's own `id`
 * so a re-save can key on it (`PutDashboardWidgetsBody.id`'s own reason for being optional). */
export function dashboardRowsFromDto(dto: DashboardDto): DashboardWidgetRow[] {
  const tabKeyById = new Map(dto.tabs.map((tab) => [tab.id, tab.key]));
  return dto.widgets.map((widget) => ({
    id: widget.id,
    // `F3.73` — conditional spread: an absent key, not `tabKey: undefined`, so `builderHasChanged`'s
    // JSON comparison and the write body treat a tab-less widget the way they did before tabs.
    ...(widget.tabId !== null && tabKeyById.has(widget.tabId) ? { tabKey: tabKeyById.get(widget.tabId)! } : {}),
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
  return problems.filter(
    (problem) => selected === null || problem.widget !== selected || problem.field === SCOPE_PROBLEM_FIELD,
  );
}

/**
 * `F3.32` review finding — the field of a problem about the widget's fit to the dashboard's
 * SCOPE. `WidgetInspector` renders a problem only through its own fields, and the scope is a page
 * field, so a scope problem on the selected widget would render nowhere; the summary keeps it
 * whatever is selected (`unselectedDashboardBuilderProblems` above).
 */
export const SCOPE_PROBLEM_FIELD = "scope";

/** The sentence `dashboardBuilderErrors` reports for a plant mimic with no group to resolve
 * against: neither the dashboard's scope nor the tab it sits on is an asset group. */
export const MIMIC_NEEDS_ASSET_GROUP_MESSAGE =
  "A plant mimic needs an asset-group scope, or a tab bound to an asset group.";

/** `F3.73` plan D2 — the fields of a tab the client rules read. `DashboardDto["tabs"]` and
 * `TabWritePayload[]` both fit, so either page passes what it already holds. */
export type TabForRules = { readonly key: string; readonly label: string; readonly assetGroupId: string | null };

/** `F3.73` D11 — the field of a problem about the tab set. Reported with `widget: null`, so the
 * page summary shows it whatever is selected. */
export const TABS_PROBLEM_FIELD = "tabs";

/** The API's `tabWriteSchema.label` bound (`varchar(128)`). */
const MAX_TAB_LABEL_LENGTH = 128;

/**
 * `F3.73` D11 — the tab set's own rules, the API's `tabWriteSchema` and `tabRulesHold` mirror:
 * the tab cap, a well-formed key, the reserved `assets` key (named first, so the author reads
 * why rather than the generic key sentence), unique keys and a label. And the service's
 * `TAB_GROUP_SCOPE_MESSAGE` mirror: a group tab needs a location scope — otherwise the save's
 * PATCH commits the new scope and the PUT then answers 400.
 */
function tabSetErrors(tabs: readonly TabForRules[], scopeKind: DashboardScopeValue["kind"]): DashboardBuilderProblem[] {
  const problems: DashboardBuilderProblem[] = [];
  const push = (message: string): void => {
    problems.push({ widget: null, field: TABS_PROBLEM_FIELD, message });
  };
  if (tabs.length > MAX_DASHBOARD_TABS) {
    push(`A dashboard holds at most ${MAX_DASHBOARD_TABS} tabs. This one has ${tabs.length}.`);
  }
  const seen = new Set<string>();
  tabs.forEach((tab, index) => {
    const subject = `Tab ${index + 1}`;
    if (RESERVED_DASHBOARD_TAB_KEYS.includes(tab.key)) {
      push(`${subject}: the key "${tab.key}" is reserved for the site's Assets & RTUs page.`);
    } else if (!dashboardTabKeySchema.safeParse(tab.key).success) {
      push(`${subject}: a key is 1 to 64 lowercase letters, digits or hyphens.`);
    } else if (seen.has(tab.key)) {
      push(`${subject}: another tab already uses the key "${tab.key}".`);
    }
    seen.add(tab.key);
    const label = tab.label.trim();
    if (label === "") {
      push(`${subject} needs a label.`);
    } else if (label.length > MAX_TAB_LABEL_LENGTH) {
      push(`${subject}: a label is at most ${MAX_TAB_LABEL_LENGTH} characters.`);
    }
    if (tab.assetGroupId !== null && scopeKind !== "location") {
      push(`${subject} binds an asset group, and only a location dashboard carries group tabs. Clear its group or choose a location.`);
    }
  });
  return problems;
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

/** One summary entry on a tabbed builder: the problem, the tab its widget sits on, and its subject. */
export type TabbedBuilderProblem = {
  readonly problem: DashboardBuilderProblem;
  /** The key of the tab the problem's widget sits on; `null` for a set-level problem, a widget on
   * no tab, or a canvas with no tabs — a problem the summary cannot take the author to. */
  readonly tabKey: string | null;
  readonly subject: string;
};

/**
 * `F3.73` critique fix — the summary of a tabbed builder, grouped by tab. The canvas shows one tab
 * and numbers no tile, so "Widget 7 (UPS load)" names a widget the author cannot find. A widget on
 * a tab is named by the tab's label and its own title instead ("Electrical › UPS load"), and the
 * entries come in tab order — the ones with no tab first — so one tab's problems read together.
 * The page makes a tabbed entry a button that selects its tab. With no tabs, the subjects are
 * `dashboardBuilderProblemSubject`'s and the order is kept.
 */
export function tabbedDashboardBuilderProblems(
  rows: readonly DashboardWidgetRow[],
  tabs: readonly TabForRules[],
  problems: readonly DashboardBuilderProblem[],
): TabbedBuilderProblem[] {
  const tabIndex = new Map<string, number>();
  tabs.forEach((tab, index) => {
    if (!tabIndex.has(tab.key)) {
      tabIndex.set(tab.key, index);
    }
  });
  const located = problems.map((problem): TabbedBuilderProblem & { order: number } => {
    const row = problem.widget === null ? undefined : rows[problem.widget];
    const position = row?.tabKey === undefined ? undefined : tabIndex.get(row.tabKey);
    const tab = position === undefined ? undefined : tabs[position];
    if (row === undefined || position === undefined || tab === undefined) {
      return { problem, tabKey: null, subject: dashboardBuilderProblemSubject(rows, problem), order: -1 };
    }
    const label = row.title.trim() || WIDGET_CATALOG[row.widgetType].label;
    return { problem, tabKey: tab.key, subject: `${tab.label.trim() || tab.key} › ${label}`, order: position };
  });
  // `Array.prototype.sort` is stable, so the problems keep their order within a tab.
  return located.sort((a, b) => a.order - b.order).map(({ problem, tabKey, subject }) => ({ problem, tabKey, subject }));
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
export function dashboardBuilderErrors(
  rows: readonly DashboardWidgetRow[],
  scopeKind: DashboardScopeValue["kind"],
  // `F3.73` — REQUIRED, not defaulted: an omitted list would count every row against one cap
  // and refuse a mimic on a group tab, and tsc would stay green at the call site.
  tabs: readonly TabForRules[],
): DashboardBuilderProblem[] {
  const problems: DashboardBuilderProblem[] = [];
  const push = (widget: number | null, field: string, message: string): void => {
    problems.push({ widget, field, message });
  };

  // `F3.73` plan D2 — the API's `tabRulesHold` mirror: `MAX_DASHBOARD_WIDGETS` holds per tab,
  // and on the single canvas of a dashboard without tabs (the `""` bucket).
  const perCanvas = new Map<string, number>();
  for (const row of rows) {
    const canvas = row.tabKey ?? "";
    perCanvas.set(canvas, (perCanvas.get(canvas) ?? 0) + 1);
  }
  for (const [canvas, count] of perCanvas) {
    if (count > MAX_DASHBOARD_WIDGETS) {
      push(
        null,
        "widgets",
        canvas === ""
          ? `A dashboard without tabs holds at most ${MAX_DASHBOARD_WIDGETS} widgets. This one has ${count}.`
          : `The tab "${canvas}" holds at most ${MAX_DASHBOARD_WIDGETS} widgets. It has ${count}.`,
      );
    }
  }
  problems.push(...tabSetErrors(tabs, scopeKind));
  const groupTabKeys = new Set(tabs.filter((tab) => tab.assetGroupId !== null).map((tab) => tab.key));
  const tabKeys = new Set(tabs.map((tab) => tab.key));

  rows.forEach((row, index) => {
    // `F3.73` plan D2 — the API's `TAB_KEY_REQUIRED_MESSAGE` mirror: on a dashboard with tabs every
    // widget names one, or the PATCH commits and the PUT then answers 400.
    if (tabs.length > 0 && row.tabKey === undefined) {
      push(index, "tabKey", "A dashboard with tabs needs every widget on a tab.");
    }
    // `F3.73` D11 — the API's `TAB_KEY_UNKNOWN_MESSAGE` mirror (a tab-less dashboard has no key to name).
    if (row.tabKey !== undefined && !tabKeys.has(row.tabKey)) {
      push(index, "tabKey", `This widget sits on the tab "${row.tabKey}", which this dashboard does not have.`);
    }
    // `F3.73` D11 — the API's `TAB_TARGET_UNKNOWN_MESSAGE` mirror. An empty target is
    // `widgetConfigErrors`'s "Choose the tab" problem, so it is not reported twice.
    const target = row.widgetType === "module_summary_card" ? (row.config.targetTabKey ?? "") : "";
    if (target !== "" && !tabKeys.has(target)) {
      push(index, "targetTabKey", `This card links to the tab "${target}", which this dashboard does not have.`);
    }
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
    // Its API twin is `exactlyOneBindingKind`, on the widgets array rather than on a
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
    //
    // `F3.32` — a type that binds nothing (the plant mimic, ADR 0079) is exempt, as it is from
    // `exactlyOneBindingKind` on the API side: its empty arrays are its whole binding contract.
    if (row.points.length === 0 && row.sources.length === 0 && !widgetTypeBindsNothing(row.widgetType)) {
      push(index, "points", bindingRequiredMessage(label));
    }
    if (row.points.length > 0 && row.sources.length > 0) {
      push(index, "points", bindingExclusiveMessage(label));
    }

    // `F3.32` review finding (ADR 0079 decision 4). `offerableWidgetTypes` hides the button on a
    // non-group scope, but a mimic already on the canvas stays when the author switches scope
    // away from the group. Without this problem Save stayed enabled, and the save sequence
    // committed the dashboard (POST, or the PATCH of the new scope) before the widget PUT met the
    // API's 400. `scopeKind` is REQUIRED, so neither page can call this without the live scope.
    //
    // `F3.73` plan D2 — the API's `mimicGroupFor` mirror: a mimic resolves against the
    // dashboard's group, or else the group of the tab it sits on, so a mimic on a group-bound tab
    // is legal on any scope kind. A mimic on the Overview tab (no group) still needs a group scope.
    //
    // `F3.74` — and else the group of the tab its `config.tabKey` names (the API's `mimicGroupFor`).
    // No key keeps the scope sentence; a key that names no group-bound tab is `MIMIC_TAB_MESSAGE`,
    // the API's own sentence, on the key's field so the inspector's select shows it.
    if (
      needsAssetGroup(row.widgetType) &&
      scopeKind !== "assetGroup" &&
      !(row.tabKey !== undefined && groupTabKeys.has(row.tabKey))
    ) {
      const named = row.config.mimicTabKey;
      if (named === undefined) {
        push(index, SCOPE_PROBLEM_FIELD, MIMIC_NEEDS_ASSET_GROUP_MESSAGE);
      } else if (!groupTabKeys.has(named)) {
        push(index, "mimicTabKey", MIMIC_TAB_MESSAGE);
      }
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
  if (row.tabKey !== undefined) {
    identity.tabKey = row.tabKey;
  }
  const title = row.title.trim();
  if (title !== "") {
    identity.title = title;
  }
  return identity;
}

/**
 * The patch that removes one catalog source from a widget (`F3.35` Stage B).
 *
 * **A function rather than two lines inside `WidgetInspector`, because it carries a decision
 * and a `.tsx` handler is outside the coverage denominator** — the split `ValueTileWidget`'s
 * docblock makes about `toKpiTileProps`, applied to a write path.
 *
 * The decision: **removing the source clears the column projection with it.** The columns
 * belong to the dataset that was bound, not to the widget. Left behind, an author who rebinds a
 * table from `alarms.active` to `workorders.open` keeps the first dataset's column names, and
 * `eachTableColumnIsDeclared` answers 400 for a change they never made — pointing at a field
 * the picker no longer shows them.
 *
 * Cleared unconditionally rather than only for a table: `tableColumns` is meaningless on every
 * other widget type and is already empty there, so a type check here would be a branch that can
 * only ever agree with itself.
 */
export function widgetRowAfterRemovingSource(
  row: DashboardWidgetRow,
  index: number,
): Partial<DashboardWidgetRow> {
  return {
    sources: row.sources.filter((_, position) => position !== index),
    config: { ...row.config, tableColumns: [] },
  };
}

/** Builds the whole `PUT /dashboards/:id/widgets` body — `buildWidgetPayload`'s shape in
 * `template-dashboard-form.ts`, over the live widget's richer `points` array instead of
 * `pointKeys`. */
export function buildPutWidgetsPayload(
  rows: readonly DashboardWidgetRow[],
  tabs: readonly TabWritePayload[],
): PutDashboardWidgetsPayload {
  return {
    // `tabs` is REQUIRED, not defaulted: an omitted argument at a call site would send `[]` and
    // the API's diff would delete every stored tab on an unrelated save.
    tabs: [...tabs],
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
        case "table":
          return { ...identity, widgetType: "table", config: buildTableConfig(row.config) };
        case "mimic":
          return { ...identity, widgetType: "mimic", config: buildMimicConfig(row.config) };
        case "active_alarms_rail":
          return { ...identity, widgetType: "active_alarms_rail", config: buildActiveAlarmsRailConfig(row.config) };
        case "state_legend":
          return { ...identity, widgetType: "state_legend", config: {} };
        case "asset_class_strip":
          return { ...identity, widgetType: "asset_class_strip", config: {} };
        case "module_summary_card":
          return { ...identity, widgetType: "module_summary_card", config: buildModuleSummaryCardConfig(row.config) };
        case "critical_systems_list":
          return { ...identity, widgetType: "critical_systems_list", config: {} };
        default: {
          const unreachable: never = row.widgetType;
          throw new Error(`Unhandled widget type ${JSON.stringify(unreachable)}`);
        }
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

/** `F3.73` D11 — whether the edited tab set differs from the stored one. The tab edits below
 * renumber `sortOrder` only when the order moves, so an unedited set compares equal. */
export function tabsHaveChanged(tabs: readonly TabWritePayload[], dto: DashboardDto): boolean {
  return JSON.stringify(tabs) !== JSON.stringify(tabWritesFromDto(dto.tabs));
}

/** The page summary's sentence for `tabLocationMoveProblems`; exported for the specs. */
export const TAB_LOCATION_MOVE_PROBLEM =
  "This dashboard's saved tabs bind asset groups at its site, so it cannot leave that site in this save. " +
  "Put the site back, clear the tabs' groups and save, then move the dashboard.";

/**
 * `F3.73` review finding — the API's `TAB_LOCATION_MOVE_MESSAGE` mirror, judged against the
 * STORED tabs. `dashboard_tabs_dashboard_id_location_id_fkey` refuses the PATCH that moves a
 * dashboard (to another site, or to a scope with no site) while a saved tab binds a group, and the
 * save sends that PATCH before the PUT that would clear the group — so clearing the groups in the
 * panel and moving in one save met the same 400 again. `next` is `scopePatch`'s output: an asset
 * scope sends no `locationId`, so it never moves.
 */
export function tabLocationMoveProblems(
  stored: { readonly locationId: string | null; readonly tabs: readonly { readonly assetGroupId: string | null }[] },
  next: { readonly locationId?: string | null; readonly assetGroupId?: string | null },
): DashboardBuilderProblem[] {
  const moves = next.locationId !== undefined && next.locationId !== stored.locationId;
  if (!moves || !stored.tabs.some((tab) => tab.assetGroupId !== null)) {
    return [];
  }
  return [{ widget: null, field: TABS_PROBLEM_FIELD, message: TAB_LOCATION_MOVE_PROBLEM }];
}

/**
 * `F3.73` D11 — the tab set and the rows edited together. A tab edit that changes a key, or
 * removes a tab, must move the rows with it, so the edits below take and return both. They live
 * here rather than in the panel's handlers because a `.tsx` handler is outside the coverage
 * denominator (`widgetRowAfterRemovingSource`'s reason).
 */
export type BuilderTabsState = {
  readonly tabs: readonly TabWritePayload[];
  readonly rows: readonly DashboardWidgetRow[];
};

const renumbered = (tabs: readonly TabWritePayload[]): TabWritePayload[] =>
  tabs.map((tab, position) => ({ ...tab, sortOrder: position }));

/**
 * Adds a tab with the first free `tab-N` key and no group. **The first tab adopts every widget
 * already on the canvas**: the builder shows one tab's widgets at a time, so an untabbed widget
 * would be hidden while "needs every widget on a tab" blocks Save.
 *
 * The set is renumbered from position (review finding): a site-layout copy keeps the template's
 * `sortOrder`s with gaps where tabs were omitted (`0, 1, 2, 3, 6`), so `state.tabs.length` would
 * save the new tab before the last stored one, or tie with it, while the panel shows it last.
 */
export function addBuilderTab(state: BuilderTabsState): BuilderTabsState & { key: string } {
  const taken = new Set(state.tabs.map((tab) => tab.key));
  let n = 1;
  while (taken.has(`tab-${n}`)) {
    n += 1;
  }
  const key = `tab-${n}`;
  const tabs = renumbered([...state.tabs, { key, label: `Tab ${n}`, sortOrder: 0, assetGroupId: null }]);
  const rows = state.tabs.length === 0 ? state.rows.map((row) => ({ ...row, tabKey: key })) : [...state.rows];
  return { tabs, rows, key };
}

/**
 * Re-keys one tab, and moves its widgets and every module summary card that links to it with it.
 * Answers `null` when another tab holds the key: applying it would put two tabs' widgets under one
 * key, and no later edit could tell them apart again.
 */
export function renameBuilderTabKey(state: BuilderTabsState, index: number, key: string): BuilderTabsState | null {
  const tab = state.tabs[index];
  if (!tab) {
    return state;
  }
  if (state.tabs.some((other, position) => position !== index && other.key === key)) {
    return null;
  }
  const from = tab.key;
  return {
    tabs: state.tabs.map((other, position) => (position === index ? { ...other, key } : other)),
    rows: state.rows.map((row) => {
      const next = row.tabKey === from ? { ...row, tabKey: key } : row;
      return next.config.targetTabKey === from ? { ...next, config: { ...next.config, targetTabKey: key } } : next;
    }),
  };
}

/** Moves one tab by `delta` places and renumbers `sortOrder` from position. A move past either
 * end answers the same array. */
export function moveBuilderTab(
  tabs: readonly TabWritePayload[],
  index: number,
  delta: -1 | 1,
): readonly TabWritePayload[] {
  const target = index + delta;
  if (target < 0 || target >= tabs.length) {
    return tabs;
  }
  const next = [...tabs];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return renumbered(next);
}

/**
 * Removes one tab **and its widgets** — the API cascades them on save, so the builder shows the
 * same result before the save. A card that linked to the tab stays, with the target problem
 * `dashboardBuilderErrors` reports. With no tab left the dashboard is one canvas again, so no
 * widget keeps a `tabKey` (the API refuses one on a tab-less body).
 */
export function removeBuilderTab(state: BuilderTabsState, index: number): BuilderTabsState {
  const tab = state.tabs[index];
  if (!tab) {
    return state;
  }
  const tabs = renumbered(state.tabs.filter((_, position) => position !== index));
  const kept = state.rows.filter((row) => row.tabKey !== tab.key);
  const rows =
    tabs.length > 0
      ? kept
      : kept.map((row) => {
          const { tabKey: _dropped, ...rest } = row;
          return rest;
        });
  return { tabs, rows };
}
