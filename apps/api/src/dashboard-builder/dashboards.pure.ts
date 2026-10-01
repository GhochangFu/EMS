import { dashboards, dashboardTabs, dashboardWidgets } from "@bms/db";
import type { DashboardSummaryDto, DashboardTabDto, DashboardWidgetDto, DashboardWidgetSourceDto } from "@bms/shared";

import type { ResolvedBoundPoint } from "./dashboard-point-scope";
import type { TabWriteBody, WidgetWriteBody } from "./dashboards.schema";

export type DashboardRow = typeof dashboards.$inferSelect;
export type WidgetRow = typeof dashboardWidgets.$inferSelect;
export type TabRow = typeof dashboardTabs.$inferSelect;

// ---------------------------------------------------------------------------
// Pure functions — no database. Exported so dashboards.service.spec.ts covers
// them without a Nest module or a connection (§4.6).
// ---------------------------------------------------------------------------

/** Row -> DTO. Parses against `dashboardSummaryDtoSchema` in the caller's own test — this
 * function only builds the shape. */
export function mapDashboardSummary(
  row: DashboardRow,
  widgetCount: number,
  assetCode: string | null,
): DashboardSummaryDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    locationId: row.locationId,
    assetGroupId: row.assetGroupId,
    assetId: row.assetId,
    assetTemplateId: row.assetTemplateId,
    assetCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    widgetCount,
  };
}

/**
 * Row -> DTO for one widget. `widgetType`/`config` are cast, not re-validated: the DB CHECK
 * (`dashboard_widgets_widget_type_check`) guarantees `widgetType` is one of the four values, the
 * same trust `AdminAssetPointDto`'s `sourceKind` cast already extends to `sourceKind_check`.
 *
 * **One cast, not two (found in review).** `merged as unknown as DashboardWidgetDto` defeats the
 * compiler entirely — going through `unknown` accepts any shape at all, on the one mapper that
 * builds a response DTO. `merged as DashboardWidgetDto` alone still typechecks: TypeScript's
 * "insufficient overlap" check only refuses a direct cast between structurally unrelated types,
 * and `merged`'s inferred shape already carries every field of the target intersection under
 * the same names — the discriminant `widgetType` just is not narrowed to one arm's literal
 * (impossible statically here; it is a runtime value from `row`), which is exactly the residual
 * risk this comment records rather than a stronger cast hides.
 */
export function mapDashboardWidget(
  row: WidgetRow,
  points: readonly ResolvedBoundPoint[],
  sources: readonly DashboardWidgetSourceDto[] = [],
): DashboardWidgetDto {
  const merged = {
    id: row.id,
    dashboardId: row.dashboardId,
    organizationId: row.organizationId,
    // `F3.73` (plan D1) — null is the legacy single canvas.
    tabId: row.tabId,
    title: row.title,
    gridX: row.gridX,
    gridY: row.gridY,
    gridW: row.gridW,
    gridH: row.gridH,
    points: points.map((point) => ({
      id: point.id,
      pointId: point.pointId,
      role: point.role as "primary" | "series",
      sortOrder: point.sortOrder,
      assetId: point.assetId,
      assetCode: point.assetCode,
      pointKey: point.pointKey,
      unit: point.unit,
    })),
    // `F3.35` Stage C. Defaulted to `[]` rather than left out, because the cast below is what
    // makes an omission compile: `dashboardWidgetIdentitySchema` gained a required `sources`
    // array, `apps/api` never parses its own response, and `checkResponse` in `apps/web` throws
    // in dev and test on every dashboard read. So a missing key here is not a type error, not
    // an API error, and not visible until a browser opens a dashboard. The default keeps the
    // emitter true to the contract at every commit; Unit 3 passes the real rows.
    sources: sources.map((source) => ({
      id: source.id,
      catalogKey: source.catalogKey,
      params: source.params,
      sortOrder: source.sortOrder,
    })),
    widgetType: row.widgetType,
    config: row.config,
  };
  return merged as DashboardWidgetDto;
}

/** One stored widget's content, in the shape the diff compares against a submitted one. */
export type StoredWidgetForDiff = {
  readonly id: string;
  /** `F3.73` (plan D2). In the diff so a widget whose ONLY change is its tab lands in
   * `updates` — otherwise a move between tabs answers 200 and the widget stays where it was. */
  readonly tabId: string | null;
  readonly widgetType: string;
  readonly title: string | null;
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
  readonly config: unknown;
  readonly points: readonly { pointId: string; role: string; sortOrder: number }[];
  /** `F3.35` Stage C. In the diff for the same reason `points` is: a widget whose ONLY change
   * is its catalog binding must land in `updates`, not in `unchangedIds`. */
  readonly sources: readonly { catalogKey: string; params: unknown; sortOrder: number }[];
};

export type WidgetSyncDiff = {
  readonly updates: readonly WidgetWriteBody[];
  readonly inserts: readonly WidgetWriteBody[];
  readonly deleteIds: readonly string[];
  readonly unchangedIds: readonly string[];
};

function pointSortKey(a: { pointId: string; role: string }, b: { pointId: string; role: string }): number {
  return a.pointId === b.pointId ? a.role.localeCompare(b.role) : a.pointId.localeCompare(b.pointId);
}

function sourceSortKey(a: { catalogKey: string }, b: { catalogKey: string }): number {
  return a.catalogKey.localeCompare(b.catalogKey);
}

/**
 * `params`, serialised with its keys sorted.
 *
 * **Not `JSON.stringify` directly, and the difference is not pedantry.** The stored side comes
 * back from `jsonb`, which normalises key order (by length, then bytewise); the submitted side
 * is a request body in the author's own order. So `{"b":1,"a":2}` saved and re-submitted
 * unchanged would serialise two different ways, the diff would call it a change, and every save
 * of an untouched dashboard would rewrite every widget carrying parameters.
 *
 * `config` above is compared with a bare `JSON.stringify` and has the same exposure. It is not
 * changed here — that is `F3.1b`'s field and a behaviour change to it belongs with a test that
 * demonstrates the symptom — but do not copy that line for a new field.
 *
 * A flat sort is exact for this value: `params` is
 * `Record<string, string | number | boolean>`, so there is no nested object whose keys could
 * also be reordered.
 */
function stableParams(params: unknown): string {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return JSON.stringify(params ?? null);
  }
  const entries = Object.entries(params as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return JSON.stringify(entries);
}

function widgetContentEqual(
  stored: StoredWidgetForDiff,
  submitted: WidgetWriteBody,
  tabIdByKey: ReadonlyMap<string, string>,
): boolean {
  if (stored.widgetType !== submitted.widgetType) return false;
  // `F3.73` — a key with no id in the map is a tab this request adds, which no stored widget
  // can already sit on, so `undefined` never equals a stored id and the widget is an update.
  const submittedTabId = submitted.tabKey === undefined ? null : tabIdByKey.get(submitted.tabKey);
  if (stored.tabId !== submittedTabId) return false;
  if ((stored.title ?? null) !== (submitted.title ?? null)) return false;
  if (
    stored.gridX !== submitted.gridX ||
    stored.gridY !== submitted.gridY ||
    stored.gridW !== submitted.gridW ||
    stored.gridH !== submitted.gridH
  ) {
    return false;
  }
  if (JSON.stringify(stored.config) !== JSON.stringify(submitted.config)) return false;

  const storedPoints = [...stored.points].sort(pointSortKey);
  const submittedPoints = [...submitted.points].sort(pointSortKey);
  if (storedPoints.length !== submittedPoints.length) return false;
  const pointsEqual = storedPoints.every(
    (point, index) =>
      point.pointId === submittedPoints[index]?.pointId &&
      point.role === submittedPoints[index]?.role &&
      point.sortOrder === submittedPoints[index]?.sortOrder,
  );
  if (!pointsEqual) return false;

  // `F3.35` Stage C. Without this block a widget whose ONLY change is its catalog binding
  // compares equal, lands in `unchangedIds`, and `putWidgets` writes nothing — the PUT answers
  // 200 carrying the old binding, and the author's rebind is silently discarded. Covered in
  // `dashboards.service.spec.ts`, which was written failing before this ran.
  const storedSources = [...stored.sources].sort(sourceSortKey);
  const submittedSources = [...(submitted.sources ?? [])].sort(sourceSortKey);
  if (storedSources.length !== submittedSources.length) return false;
  return storedSources.every(
    (source, index) =>
      source.catalogKey === submittedSources[index]?.catalogKey &&
      source.sortOrder === submittedSources[index]?.sortOrder &&
      stableParams(source.params) === stableParams(submittedSources[index]?.params),
  );
}

/**
 * `PUT :id/widgets`'s sync diff (D2): keys on a client-supplied `id` where present so ids
 * survive a re-save. A submitted widget whose id matches a stored one AND whose content is
 * byte-identical is neither updated nor deleted — it "keeps its id" with zero writes. A stored
 * widget absent from the submitted set is deleted; a submitted widget with no id, or an id
 * matching nothing stored, is inserted.
 *
 * `tabIdByKey` (`F3.73`) is `tabIdsByKey` of the request's tabs. It is required, not
 * defaulted: a caller that forgot it would compare every tabbed widget against no tab and
 * rewrite it on every save.
 */
export function diffWidgets(
  existing: readonly StoredWidgetForDiff[],
  submitted: readonly WidgetWriteBody[],
  tabIdByKey: ReadonlyMap<string, string>,
): WidgetSyncDiff {
  const existingById = new Map(existing.map((widget) => [widget.id, widget]));
  const updates: WidgetWriteBody[] = [];
  const inserts: WidgetWriteBody[] = [];
  const unchangedIds: string[] = [];
  const keepIds = new Set<string>();

  for (const widget of submitted) {
    const stored = widget.id !== undefined ? existingById.get(widget.id) : undefined;
    if (stored === undefined) {
      inserts.push(widget);
      continue;
    }
    keepIds.add(stored.id);
    if (widgetContentEqual(stored, widget, tabIdByKey)) {
      unchangedIds.push(stored.id);
    } else {
      updates.push(widget);
    }
  }

  const deleteIds = existing.map((widget) => widget.id).filter((id) => !keepIds.has(id));
  return { updates, inserts, deleteIds, unchangedIds };
}

// ---------------------------------------------------------------------------
// `F3.73` (plan D1, D2) — dashboard tabs.
// ---------------------------------------------------------------------------

/** Row -> DTO for one tab. */
export function mapDashboardTab(row: TabRow): DashboardTabDto {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    organizationId: row.organizationId,
    key: row.tabKey,
    label: row.label,
    sortOrder: row.sortOrder,
    assetGroupId: row.assetGroupId,
  };
}

/**
 * The request's key -> stored tab id, for the tabs that carry an id. A tab without one is new
 * and has no id until the service inserts it; `diffWidgets` reads its absence as "not the
 * tab this widget is stored on". The service has already refused an id that is not one of this
 * dashboard's own tabs, so every id here is a stored one.
 */
export function tabIdsByKey(tabs: readonly TabWriteBody[]): ReadonlyMap<string, string> {
  const byKey = new Map<string, string>();
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      byKey.set(tab.key, tab.id);
    }
  }
  return byKey;
}

/**
 * The asset group a `mimic` widget resolves against (plan D2): the dashboard's own group, or
 * else the group of the tab the widget sits on. Null means a mimic there would draw every node
 * "not assigned", which `MIMIC_SCOPE_MESSAGE` refuses.
 */
export function mimicGroupFor(
  dashboardGroupId: string | null,
  tabs: readonly TabWriteBody[],
  widget: { tabKey?: string },
): string | null {
  if (dashboardGroupId !== null) {
    return dashboardGroupId;
  }
  const tab = tabs.find((candidate) => candidate.key === widget.tabKey);
  return tab?.assetGroupId ?? null;
}

/** One stored tab, in the shape `diffTabs` compares a submitted one against. */
export type StoredTabForDiff = {
  readonly id: string;
  /** The column's name, so a `TabRow` is one as it stands. */
  readonly tabKey: string;
  readonly label: string;
  readonly sortOrder: number;
  readonly assetGroupId: string | null;
};

export type TabSyncDiff = {
  /** Kept tabs whose key, label, order or group changed; each carries its stored `id`. */
  readonly updates: readonly (TabWriteBody & { id: string })[];
  readonly inserts: readonly TabWriteBody[];
  readonly deleteIds: readonly string[];
  readonly unchangedIds: readonly string[];
};

/**
 * The tab sync diff (plan D2), in `diffWidgets`' shape: a submitted tab with a stored `id` is
 * kept (updated when its content differs), one without an id is inserted, and a stored tab the
 * request omits is deleted. The caller refuses an unknown id before this runs.
 */
export function diffTabs(stored: readonly StoredTabForDiff[], submitted: readonly TabWriteBody[]): TabSyncDiff {
  const storedById = new Map(stored.map((tab) => [tab.id, tab]));
  const updates: (TabWriteBody & { id: string })[] = [];
  const inserts: TabWriteBody[] = [];
  const unchangedIds: string[] = [];
  const keepIds = new Set<string>();
  for (const tab of submitted) {
    const kept = tab.id !== undefined ? storedById.get(tab.id) : undefined;
    if (kept === undefined) {
      inserts.push(tab);
      continue;
    }
    keepIds.add(kept.id);
    const same =
      kept.tabKey === tab.key &&
      kept.label === tab.label &&
      kept.sortOrder === tab.sortOrder &&
      kept.assetGroupId === (tab.assetGroupId ?? null);
    if (same) {
      unchangedIds.push(kept.id);
    } else {
      updates.push({ ...tab, id: kept.id });
    }
  }
  const deleteIds = stored.map((tab) => tab.id).filter((id) => !keepIds.has(id));
  return { updates, inserts, deleteIds, unchangedIds };
}
