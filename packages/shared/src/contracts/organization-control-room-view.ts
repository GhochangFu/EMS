import { z } from "zod";

import { chartConfigSchema, metricCatalogKeySchema, valueTileConfigSchema } from "./dashboard-builder";
import { metricCatalogValueDtoSchema } from "./metric-catalog-values";

/**
 * `F4.317` task 4.2 (ADR 0112 decisions 3, 4 and 5) — the organization Control Room strip's
 * contracts: the read `GET /control-room/organizations/:organizationId/view`, the "Make
 * organization layout" body and answer `PUT …/view`, and the instantiate organization arm's
 * answer (the same copy action).
 */

/**
 * `stock`: no view row, or a row whose dashboard is gone or is not this organization's
 * organization-wide dashboard — the strip is `organization-standard`'s content (decision 3, the
 * fail-safe). `dashboard`: the row's copy, edited in the builder.
 */
export const organizationControlRoomViewKindSchema = z.enum(["stock", "dashboard"]);

/**
 * One catalog source of a tile, with its value. `resolved` is `null` when the binding did not
 * resolve (its stored params no longer pass the entry's write schema): the tile shows "—".
 */
export const organizationStripSourceDtoSchema = z.object({
  catalogKey: metricCatalogKeySchema,
  /**
   * `F4.332` — the binding's `params.pointKey` for a `sustainability.*` source, else `null`, so the
   * strip can mark a stored `energy_cost_*` point "at the rate effective now" (ADR 0070
   * Amendment 7 decision 8). Defaulted, so a reader of the older shape parses.
   */
  pointKey: z.string().max(128).nullable().default(null),
  sortOrder: z.number().int(),
  resolved: metricCatalogValueDtoSchema.nullable(),
});

/**
 * One value tile of the strip. `key` is the stock widget's key, or the copy's widget id. The
 * config is `valueTileConfigSchema`'s (the strip draws value tiles only, decision 2). Sources come
 * in `sortOrder`: the first is the tile's primary, tile 3's second its critical count (ruling Q1b).
 */
export const organizationStripTileDtoSchema = z.object({
  key: z.string().min(1),
  title: z.string().nullable(),
  gridX: z.number().int(),
  gridY: z.number().int(),
  gridW: z.number().int(),
  gridH: z.number().int(),
  config: valueTileConfigSchema,
  /**
   * `F4.332` (ADR 0112 Amendment 3 item 4) — a strip widget is a value tile or the daily energy
   * cost chart. Defaulted to a tile, so a reader of the older shape parses; a chart carries its
   * own config in `chartConfig` (and `config` is `{}`), rather than a union `config` that a
   * non-strict tile schema would also accept.
   */
  widgetType: z.enum(["value_tile", "chart"]).default("value_tile"),
  chartConfig: chartConfigSchema.nullable().default(null),
  sources: z.array(organizationStripSourceDtoSchema),
});

/**
 * The strip as one caller reads it: every value resolved over that caller's readable assets of
 * the organization (decision 5). `layoutName` is the "Layout: …" status line — the stock
 * template's name, or the copy's dashboard name. `canManage`: whether this caller may Make or
 * Reset the layout and edit the copy (the web shows the buttons on it; the API decides again).
 */
export const organizationControlRoomViewDtoSchema = z.object({
  organizationId: z.string().uuid(),
  kind: organizationControlRoomViewKindSchema,
  dashboardId: z.string().uuid().nullable(),
  dashboardSlug: z.string().nullable(),
  layoutName: z.string(),
  canManage: z.boolean(),
  tiles: z.array(organizationStripTileDtoSchema),
  resolvedAt: z.string().datetime(),
});

/**
 * `PUT …/view` — "Make organization layout". No `templateId`: the organization's newest published
 * `organization` template. `.strict()`: one optional key, so a misspelt `templateID` dropped
 * silently would copy a template the caller did not name.
 */
export const putOrganizationControlRoomViewBodySchema = z
  .object({
    templateId: z.string().uuid().optional(),
  })
  .strict();

/** What the copy action answers (`PUT …/view`, and the instantiate organization arm). */
export const organizationLayoutResultDtoSchema = z.object({
  organizationId: z.string().uuid(),
  dashboardId: z.string().uuid(),
  dashboardSlug: z.string(),
  templateId: z.string().uuid(),
});

/** Ruling Q2 — "Make organization layout" over a live layout is refused (409). */
export const ORGANIZATION_HAS_LAYOUT_MESSAGE = "This organization already has a layout. Reset to default first.";

/**
 * ADR 0112 decisions 2 and 5 — the narrow `location_admin` grant on the pointed dashboard admits
 * the organization target's content only: value tiles, no tabs (400).
 */
export const ORGANIZATION_STRIP_CONTENT_MESSAGE =
  "The organization strip holds value tiles and the daily energy cost chart only, with no tabs " +
  "(ADR 0112 decision 2 and Amendment 3)";

/**
 * `F4.332` (ADR 0112 Amendment 3 item 3) — whether a widget may sit on the organization strip: a
 * value tile, or a chart of the `cost_by_day` kind. One predicate for the template target
 * (`templateTargetContentMessage`) and the location-admin write to the pointed copy
 * (`DashboardsService.putWidgets`), so the two cannot admit different widgets.
 */
export function organizationStripHolds(widget: {
  readonly widgetType: string;
  readonly config: unknown;
  /** When the caller has them: a strip chart binds the one `energy.cost_by_day` source … */
  readonly sources?: readonly { readonly catalogKey: string }[];
  /** … and no point or role binding (the write schemas hold this too; this is the second guard). */
  readonly points?: readonly unknown[];
  readonly bindings?: readonly unknown[];
}): boolean {
  if (widget.widgetType === "value_tile") return true;
  if (widget.widgetType !== "chart" || typeof widget.config !== "object" || widget.config === null) return false;
  if ((widget.config as { series?: unknown }).series !== "cost_by_day") return false;
  if ((widget.points?.length ?? 0) > 0 || (widget.bindings?.length ?? 0) > 0) return false;
  return widget.sources === undefined || (widget.sources.length === 1 && widget.sources[0]?.catalogKey === "energy.cost_by_day");
}

/** No published `organization` template to copy (409). */
export const NO_ORGANIZATION_TEMPLATE_MESSAGE =
  "This organization has no published organization template to make a layout from";

// Types here rather than in `src/index.ts`, which sits at the AGENTS.md §4.5 cap; `export *` from
// `./contracts` carries them out (the `dashboard-template-writes.ts` precedent).
export type OrganizationControlRoomViewKind = z.infer<typeof organizationControlRoomViewKindSchema>;
export type OrganizationStripSourceDto = z.infer<typeof organizationStripSourceDtoSchema>;
export type OrganizationStripTileDto = z.infer<typeof organizationStripTileDtoSchema>;
export type OrganizationControlRoomViewDto = z.infer<typeof organizationControlRoomViewDtoSchema>;
export type PutOrganizationControlRoomViewBody = z.infer<typeof putOrganizationControlRoomViewBodySchema>;
export type OrganizationLayoutResultDto = z.infer<typeof organizationLayoutResultDtoSchema>;
