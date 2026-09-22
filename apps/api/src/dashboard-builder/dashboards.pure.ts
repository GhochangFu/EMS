import { dashboards, dashboardWidgets } from "@bms/db";
import type { DashboardSummaryDto, DashboardWidgetDto, DashboardWidgetSourceDto } from "@bms/shared";

import type { ResolvedBoundPoint } from "./dashboard-point-scope";
import type { WidgetWriteBody } from "./dashboards.schema";

export type DashboardRow = typeof dashboards.$inferSelect;
export type WidgetRow = typeof dashboardWidgets.$inferSelect;

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

function widgetContentEqual(stored: StoredWidgetForDiff, submitted: WidgetWriteBody): boolean {
  if (stored.widgetType !== submitted.widgetType) return false;
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
 */
export function diffWidgets(
  existing: readonly StoredWidgetForDiff[],
  submitted: readonly WidgetWriteBody[],
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
    if (widgetContentEqual(stored, widget)) {
      unchangedIds.push(stored.id);
    } else {
      updates.push(widget);
    }
  }

  const deleteIds = existing.map((widget) => widget.id).filter((id) => !keepIds.has(id));
  return { updates, inserts, deleteIds, unchangedIds };
}
