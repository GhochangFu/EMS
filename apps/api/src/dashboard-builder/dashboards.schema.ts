import { z } from "zod";

import {
  chartConfigSchema,
  commonConfigFields,
  gaugeRangeIsOrdered,
  gaugeThresholdSchema,
  DASHBOARD_GRID,
  GAUGE_RANGE_MESSAGE,
  MAX_DASHBOARD_WIDGETS,
  MAX_GAUGE_THRESHOLDS,
  tankLevelConfigSchema,
  valueTileConfigSchema,
  widgetPointRoleSchema,
  widgetTypeSchema,
  WIDGET_POINT_CARDINALITY,
} from "@bms/shared";

/**
 * `F3.1b` — the dashboard request bodies (ADR 0047).
 *
 * **Request bodies do NOT live in `packages/shared/src/contracts/`.** That is ADR 0030's
 * response home; every request body in this repo lives in an `apps/api/src/**\/*.schema.ts`,
 * and this is the dashboard one. `packages/shared`'s `dashboard-builder.ts` still owns the
 * vocabulary — `widgetTypeSchema`, `WIDGET_POINT_CARDINALITY`, `MAX_DASHBOARD_WIDGETS`, the four
 * config schemas — and every schema below imports rather than restates it.
 *
 * **Do not build the scope refine or the config arms with `z.intersection` here.** Two strict
 * halves parse nothing: an object rejects the OTHER half's keys as unrecognized, so
 * `z.intersection(identity.strict(), spec.strict())` fails on every legitimate payload. This
 * already happened once, on the response side — `dashboard-builder.ts`'s own docblock (60-65)
 * records it. The legal shape here is a flat `z.object().strict()` per verb, and a
 * `z.discriminatedUnion` of strict object arms for the widget itself: `z.discriminatedUnion`
 * accepts only `ZodObject` arms, so neither `z.intersection` nor a `.refine()`/`.superRefine()`
 * on an arm can build one — that refinement has to live on a FIELD inside the arm (the points
 * array below) or outside the whole union (nowhere is needed here; see `widgetsWriteFieldSchema`
 * for where the cross-widget grid check landed instead).
 */

// ---------------------------------------------------------------------------
// bms.dashboards — create / update
// ---------------------------------------------------------------------------

/** At most one of `locationId`/`assetGroupId` — `dashboards_scope_check` in SQL. */
const SCOPE_REFUSAL_MESSAGE =
  "at most one of locationId or assetGroupId may be set — both null is organization-wide";

const scopeIsSingular = (data: {
  locationId?: string | null;
  assetGroupId?: string | null;
}): boolean => !(data.locationId != null && data.assetGroupId != null);

/**
 * The raw fields, undecorated — `updateDashboardBodySchema` is built from this by
 * `.omit({organizationId:true}).partial()`, which preserves `.strict()`
 * (`strict-body-ledger.spec.ts`'s own docblock records this precisely: `.partial()`,
 * `.extend()` and `.omit()` all preserve `unknownKeys`). `updateLocationBodySchema` is the
 * precedent this copies.
 */
const dashboardFieldsSchema = z
  .object({
    organizationId: z.string().uuid(),
    // Copies `createLocationBodySchema`'s rule exactly.
    slug: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(255),
    description: z.string().max(4000).nullable().optional(),
    locationId: z.string().uuid().nullable().optional(),
    assetGroupId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const createDashboardBodySchema = dashboardFieldsSchema
  .refine(scopeIsSingular, { message: SCOPE_REFUSAL_MESSAGE, path: ["assetGroupId"] })
  .describe(
    "A dashboard is addressed by (organizationId, slug). At most one of locationId/" +
      "assetGroupId may be set; both null is an organization-wide dashboard, and ADR 0047 " +
      "Amendment 2 ruling 2 restricts who may create one of those to admin/organization_admin " +
      "— DashboardsService.create enforces that half, not this schema.",
  );

/**
 * `organizationId` is omitted rather than accepted-and-ignored: a dashboard's tenant is fixed at
 * creation, and a caller that supplies one deserves a 400 naming it as unrecognized, not a
 * silently discarded field.
 *
 * The scope refinement is restated rather than shared as a schema object, because `.refine()`
 * returns a `ZodEffects`, which has no `.omit()`/`.partial()` — the base fields have to be
 * separated from the refinement for the update variant to derive from them at all.
 */
export const updateDashboardBodySchema = dashboardFieldsSchema
  .omit({ organizationId: true })
  .partial()
  .strict()
  .refine(scopeIsSingular, { message: SCOPE_REFUSAL_MESSAGE, path: ["assetGroupId"] })
  .describe(
    "Every field is optional; organizationId cannot be changed here. At most one of " +
      "locationId/assetGroupId may be set BY THIS REQUEST — DashboardsService also checks the " +
      "row that results after merging with what is already stored, since a PATCH that sets " +
      "only one of the two columns cannot see the other's stored value.",
  );

export type CreateDashboardBody = z.infer<typeof createDashboardBodySchema>;
export type UpdateDashboardBody = z.infer<typeof updateDashboardBodySchema>;

// ---------------------------------------------------------------------------
// GET query parameters — registered in openapi-registry.ts's REQUEST_SCHEMAS
// and strict-body-ledger.spec.ts's QUERY_SCHEMAS, exactly like every other
// registered GET query schema in this repo (`locationDashboardQuerySchema` is
// the shape precedent). Unregistered, the served OpenAPI document would
// describe neither GET operation's `organizationId` parameter at all — D5's
// whole point (a caller disambiguates a slug with `?organizationId=`) would
// be undiscoverable from the document, which is exactly the failure ADR 0029
// exists to close (F4.20: a green suite and a static invariant still let a
// served document be wrong in three ways).
// ---------------------------------------------------------------------------

/** `GET /dashboards` — an optional tenant filter; admin/multi-organization callers see every
 * organization's dashboards when it is omitted. */
export const listDashboardsQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
});

/** `GET /dashboards/:slug` — D5: on the fleet pool a slug may match more than one
 * organization's dashboard, and `organizationId` is how a caller disambiguates it. */
export const getDashboardQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
});

export type ListDashboardsQuery = z.infer<typeof listDashboardsQuerySchema>;
export type GetDashboardQuery = z.infer<typeof getDashboardQuerySchema>;

// ---------------------------------------------------------------------------
// bms.dashboard_widgets / bms.dashboard_widget_points — PUT :id/widgets
// ---------------------------------------------------------------------------

/** One point binding on the write side. `.min(0)` on `sortOrder` belongs here, not on the
 * response contract — `dashboard-builder.ts`'s own comment records why the response carries
 * none: the column permits a negative and a response contract must not claim otherwise. */
export const pointBindingWriteSchema = z
  .object({
    pointId: z.string().uuid(),
    role: widgetPointRoleSchema.default("primary"),
    sortOrder: z.number().int().min(0).default(0),
  })
  .strict();

const DUPLICATE_BINDING_MESSAGE =
  "the same point may not be bound twice with the same role on one widget " +
  "(dashboard_widget_points_widget_point_role_key)";

/** Catches what `0050`'s own unique constraint would otherwise catch as a bare `23505`. */
const noDuplicateBindings = (
  points: { pointId: string; role: string }[],
  ctx: z.RefinementCtx,
): void => {
  const seen = new Set<string>();
  points.forEach((point, index) => {
    const key = `${point.pointId}:${point.role}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "pointId"],
        message: DUPLICATE_BINDING_MESSAGE,
      });
    }
    seen.add(key);
  });
};

/**
 * The per-type point-binding array (ADR 0047 Amendment 2). Reads
 * `WIDGET_POINT_CARDINALITY[type]` rather than a literal, so the 400 names the type and the
 * limit and the document describes the same rule this validates — never drifting from the
 * number `F3.1c`'s renderer and the template authoring surface also read.
 */
const pointsFieldFor = (widgetType: z.infer<typeof widgetTypeSchema>) => {
  const { min, max } = WIDGET_POINT_CARDINALITY[widgetType];
  return z
    .array(pointBindingWriteSchema)
    .min(min, `a ${widgetType} widget requires at least ${min} point binding(s)`)
    .max(max, `a ${widgetType} widget accepts at most ${max} point binding(s)`)
    .superRefine(noDuplicateBindings)
    .describe(
      `Between ${min} and ${max} point binding(s) for a ${widgetType} widget (ADR 0047 ` +
        "Amendment 2). The same point may not be bound twice with the same role.",
    );
};

const widgetIdentityWriteFields = {
  // Optional and, when present, preserves this widget's identity across a PUT :id/widgets
  // replace (D2) — a client omits it to create a new widget, and DashboardsService keys the
  // sync diff on it.
  id: z.string().uuid().optional(),
  title: z.string().max(255).nullable().optional(),
  gridX: z.number().int().min(0).max(DASHBOARD_GRID.columns - 1),
  gridY: z.number().int().min(0),
  gridW: z.number().int().min(DASHBOARD_GRID.minWidgetW).max(DASHBOARD_GRID.columns),
  gridH: z.number().int().min(DASHBOARD_GRID.minWidgetH).max(DASHBOARD_GRID.maxWidgetH),
};

/**
 * The gauge arm cannot reuse the shared config schema directly and this is the one place worth
 * writing out (per the file docblock): `.strict()` does not descend, so
 * `radialGaugeConfigObjectSchema.strict()` alone would still leave `thresholds[]`'s items
 * permissive, and an author's typo (`colour` for `tone`) would be stored in `config jsonb` and
 * silently never rendered. Every bound and rule below is imported from `@bms/shared` — only the
 * nesting is restated, mirroring `asset-templates-content.schema.ts`'s own template gauge arm.
 */
const radialGaugeWriteConfigSchema = z
  .object({
    ...commonConfigFields,
    min: z.number(),
    max: z.number(),
    thresholds: z.array(gaugeThresholdSchema.strict()).max(MAX_GAUGE_THRESHOLDS).optional(),
  })
  .strict()
  .refine(gaugeRangeIsOrdered, { message: GAUGE_RANGE_MESSAGE, path: ["max"] })
  .describe(
    "A radial gauge's scale. `max` must be greater than `min`: an inverted or empty range " +
      "gives the needle no defined position, and zod-to-json-schema emits nothing for a " +
      "refinement, so without this line the document would promise a 200 the API answers " +
      "with a 400 (ADR 0029 Amendment 1).",
  );

/**
 * The four arms, one per widget type. Each stays a plain `.strict()` `ZodObject` — never
 * wrapped in its own `.refine()`/`.superRefine()` — because `z.discriminatedUnion` accepts only
 * `ZodObject` arms; the cross-widget grid-fit check lives on the ARRAY field in
 * `widgetsWriteFieldSchema` below instead of here, for exactly that reason.
 *
 * Exported un-refined (rather than only the array it feeds) so a test can assert
 * `widgetWriteSchema.options.length === widgetTypeSchema.options.length` — the same guard
 * `templateDashboardWidgetVariants` gives `asset-templates-content.schema.spec.ts:302` — and a
 * fifth widget type added to `@bms/shared` and not to this file fails the build rather than
 * being quietly unusable on a live dashboard.
 */
export const widgetWriteSchema = z.discriminatedUnion("widgetType", [
  z
    .object({
      ...widgetIdentityWriteFields,
      widgetType: z.literal("radial_gauge"),
      config: radialGaugeWriteConfigSchema,
      points: pointsFieldFor("radial_gauge"),
    })
    .strict(),
  z
    .object({
      ...widgetIdentityWriteFields,
      widgetType: z.literal("tank_level"),
      config: tankLevelConfigSchema.strict(),
      points: pointsFieldFor("tank_level"),
    })
    .strict(),
  z
    .object({
      ...widgetIdentityWriteFields,
      widgetType: z.literal("value_tile"),
      config: valueTileConfigSchema.strict(),
      points: pointsFieldFor("value_tile"),
    })
    .strict(),
  z
    .object({
      ...widgetIdentityWriteFields,
      widgetType: z.literal("chart"),
      config: chartConfigSchema.strict(),
      points: pointsFieldFor("chart"),
    })
    .strict(),
]);

const eachWidgetFitsTheGrid = (
  widgets: { gridX: number; gridW: number }[],
  ctx: z.RefinementCtx,
): void => {
  widgets.forEach((widget, index) => {
    if (widget.gridX + widget.gridW > DASHBOARD_GRID.columns) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "gridW"],
        message: "a widget must fit inside the 12-column canvas",
      });
    }
  });
};

/**
 * The whole widget set, written whole (D2): one `PUT` replaces every widget on the dashboard in
 * one transaction, keying on a client-supplied `id` where present so ids survive a re-save.
 * Precedent: `replacePoints` in `asset-templates.service.ts`.
 *
 * The grid-fit check (`dashboard_widgets_grid_bounds_check`'s cross-field half) is a
 * `superRefine` on this ARRAY, not a `.refine()` on each widget arm — an arm must stay a plain
 * `ZodObject` for `z.discriminatedUnion` to accept it.
 */
const widgetsWriteFieldSchema = z
  .array(widgetWriteSchema)
  .max(MAX_DASHBOARD_WIDGETS)
  .superRefine(eachWidgetFitsTheGrid)
  .describe(
    `At most ${MAX_DASHBOARD_WIDGETS} widgets. Each must fit inside the ${DASHBOARD_GRID.columns}-column ` +
      `canvas (gridX + gridW <= ${DASHBOARD_GRID.columns}), the same bound ` +
      "dashboard_widgets_grid_bounds_check enforces in SQL — this gives a 400 naming the field " +
      "rather than a 500 carrying a constraint name.",
  );

export const putDashboardWidgetsBodySchema = z
  .object({
    widgets: widgetsWriteFieldSchema,
  })
  .strict();

export type WidgetWriteBody = z.infer<typeof widgetWriteSchema>;
export type PutDashboardWidgetsBody = z.infer<typeof putDashboardWidgetsBodySchema>;
