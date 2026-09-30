import { z } from "zod";

import {
  DASHBOARD_GRID,
  dashboardWidgetPointDtoSchema,
  dashboardWidgetSourceDtoSchema,
  dashboardWidgetSpecSchema,
} from "./dashboard-builder";
import { dashboardTabDtoSchema } from "./dashboard-tabs";

/**
 * `F3.73` (plan D0) — the dashboard read DTOs, moved out of `./dashboard-builder`, which sat at
 * 964 lines against the AGENTS.md §4.5 1000-line cap with three more PRs to land in it.
 *
 * The widget vocabulary, the config union, the metric catalog and the point / source DTOs stay in
 * `./dashboard-builder`; this file imports them, and nothing re-exports these schemas from there
 * (that would be an import cycle).
 */

/**
 * The widget's own fields, without type or config.
 *
 * The grid is bounded here as well as by `dashboard_widgets_grid_bounds_check`, so an author
 * gets a 400 naming the field rather than a 500 carrying a constraint name. The canvas is 12
 * columns; `gridY` is unbounded above because a long dashboard is legitimate.
 */
const dashboardWidgetIdentitySchema = z
  .object({
    id: z.string().uuid(),
    dashboardId: z.string().uuid(),
    organizationId: z.string().uuid(),
    // `F3.73` (plan D1) — the tab a widget sits on; null is the legacy single canvas.
    tabId: z.string().uuid().nullable(),
    title: z.string().max(255).nullable(),
    gridX: z.number().int().min(0).max(DASHBOARD_GRID.columns - 1),
    gridY: z.number().int().min(0),
    gridW: z.number().int().min(DASHBOARD_GRID.minWidgetW).max(DASHBOARD_GRID.columns),
    gridH: z.number().int().min(DASHBOARD_GRID.minWidgetH).max(DASHBOARD_GRID.maxWidgetH),
    // No `.max()`: cardinality is a per-widget row count that no row-level CHECK can see, so
    // the database does not enforce it and a response contract must not claim it does. The cap
    // is `MAX_WIDGET_POINTS`, enforced by `F3.1b` on write. The grid bounds above are a
    // different case — `dashboard_widgets_grid_bounds_check` really does enforce those, so
    // stating them here cannot reject a row the store can hold.
    points: z.array(dashboardWidgetPointDtoSchema),
    // No `.max()` either, and for the same reason. The *exactly one kind* rule — a widget binds
    // points or sources, never both and never neither — is a cross-field rule between these two
    // arrays, so it is enforced on write and deliberately not claimed here: a response contract
    // states what the store can hold, and the store can hold a widget mid-edit.
    sources: z.array(dashboardWidgetSourceDtoSchema),
  })
  .refine((widget) => widget.gridX + widget.gridW <= DASHBOARD_GRID.columns, {
    message: `a widget must fit inside the ${DASHBOARD_GRID.columns}-column canvas`,
    path: ["gridW"],
  });

/**
 * A widget as read.
 *
 * `z.intersection` is §4.8's prescribed encoding for `A & B` — `.merge()` flattens the two
 * object types into one, which is assignable to the intersection and is not it. The union still
 * narrows through the intersection, because `(Identity) & (A | B | C | D)` distributes.
 */
export const dashboardWidgetDtoSchema = z.intersection(
  dashboardWidgetIdentitySchema,
  dashboardWidgetSpecSchema,
);

/**
 * A dashboard with its widgets.
 *
 * `locationId` and `assetGroupId` are both nullable and at most one is set —
 * `dashboards_scope_check` is the enforcement; both null means organization-wide.
 */
export const dashboardDtoSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    // No `.min(1)`: varchar(64)/varchar(255) accept the empty string, so requiring one
    // here would reject a row the store can hold. The write bound is `F3.1b`'s.
    slug: z.string().max(64),
    name: z.string().max(255),
    description: z.string().nullable(),
    locationId: z.string().uuid().nullable(),
    assetGroupId: z.string().uuid().nullable(),
    // `F3.2` / ADR 0067 decision 1 — the fourth scope arm and the stamp that
    // names the asset template a per-asset default was built from. At most
    // one of `locationId`/`assetGroupId`/`assetId` is non-null
    // (`dashboards_scope_check`); `assetTemplateId` implies `assetId`
    // (`dashboards_asset_stamp_check`) and is mutually exclusive with
    // `templateId` (`dashboards_template_stamp_check`) — CHECKs the migration
    // enforces and this contract does not re-derive.
    assetId: z.string().uuid().nullable(),
    assetTemplateId: z.string().uuid().nullable(),
    // `F3.73` (plan D1) — the dashboard template this dashboard was instantiated from, null
    // for a hand-built one; `tabs` is empty for a legacy single-canvas dashboard.
    templateId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    tabs: z.array(dashboardTabDtoSchema),
    widgets: z.array(dashboardWidgetDtoSchema),
  });

/**
 * A dashboard in a list, without its widgets.
 *
 * Written as its own `z.object` rather than derived by omission: `.omit().extend()` flattens,
 * and the ADR 0030 source scan bans it here. The repetition is the price of the encoding rule,
 * and the file docblock says so.
 */
export const dashboardSummaryDtoSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    // No `.min(1)`: varchar(64)/varchar(255) accept the empty string, so requiring one
    // here would reject a row the store can hold. The write bound is `F3.1b`'s.
    slug: z.string().max(64),
    name: z.string().max(255),
    description: z.string().nullable(),
    locationId: z.string().uuid().nullable(),
    assetGroupId: z.string().uuid().nullable(),
    // `F3.2` / ADR 0067 decision 1, and §13's ruling on plan §12 Q1 — the
    // asset scope arm and stamp (see `dashboardDtoSchema`'s docblock for the
    // CHECKs), plus `assetCode` so the list badge can read "Asset · <code>"
    // without a second fetch. `assetCode` is on the summary DTO only —
    // `dashboardDtoSchema` does not gain it (§13).
    assetId: z.string().uuid().nullable(),
    assetTemplateId: z.string().uuid().nullable(),
    assetCode: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    widgetCount: z.number().int().min(0),
  });
