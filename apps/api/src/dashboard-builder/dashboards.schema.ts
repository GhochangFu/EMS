import { z } from "zod";

import {
  bindingExclusiveMessage,
  bindingRequiredMessage,
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
  metricCatalogKeySchema,
  widgetTypeSchema,
  WIDGET_POINT_CARDINALITY,
  WIDGET_SOURCE_CARDINALITY,
} from "@bms/shared";
import type { MetricCatalogKey } from "@bms/shared";

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

/**
 * The write-side parameter schema for every catalog entry (`F3.35` Stage C, ADR 0048).
 *
 * **A `Record` keyed on the vocabulary, so a sixth catalog entry cannot compile without an entry
 * here.** That is the same forcing `WIDGET_POINT_CARDINALITY` gives the point side, and it is
 * why this is a map rather than one shared schema.
 *
 * **Every entry is empty today, and that is a decision.** No resolve service reads a parameter
 * yet (Unit 5), and a parameter nothing reads is a value an author sets, saves, and sees no
 * effect from — the `F4.43` shape with the store on its side rather than the renderer's. Each
 * entry gains fields when the query that reads them is written.
 *
 * **DO NOT COLLAPSE THIS MAP INTO ONE SCHEMA.** The five entries are identical today and will
 * not stay identical: `alarms.active` takes a severity filter and `workorders.open` takes a
 * status, and one shared object would silently give every entry both.
 *
 * **NO ENTRY MAY DECLARE A `z.string().uuid()` FIELD**, and this is the load-bearing rule rather
 * than a style note. A binding inherits its dashboard's scope (`dashboards.location_id` /
 * `asset_group_id`); a location id inside `params` would be an id inside `jsonb` that no foreign
 * key covers and no orphan check can report — the ADR 0019 problem ADR 0048 decision 4 created a
 * fourth table to refuse, arriving one column over. The database's only bound is
 * `dashboard_widget_sources_params_object_check`, which accepts `{"locationId": "<any uuid>"}`.
 * `tests/f3.35-metric-catalog-containment.test.ts` scans this map and fails the build on `.uuid(`.
 */
export const METRIC_CATALOG_PARAMS_WRITE: Record<MetricCatalogKey, z.AnyZodObject> = {
  "alarms.active.count": z.object({}).strict(),
  "alarms.active": z.object({}).strict(),
  "workorders.open.count": z.object({}).strict(),
  "workorders.open": z.object({}).strict(),
  "assets.health.score": z.object({}).strict(),
};

/**
 * One catalog binding on a widget.
 *
 * `params` is validated against the entry's own schema in a `superRefine` rather than by a
 * `z.discriminatedUnion` over `catalogKey`: the union would need a tuple type built from the
 * `Record`, which costs a cast, and the refinement states the same rule with the failing key
 * named in the message.
 */
const sourceBindingWriteSchema = z
  .object({
    catalogKey: metricCatalogKeySchema,
    params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
    sortOrder: z.number().int().min(0).default(0),
  })
  .strict()
  .superRefine((binding, ctx) => {
    const parsed = METRIC_CATALOG_PARAMS_WRITE[binding.catalogKey].safeParse(binding.params);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["params", ...issue.path],
          message: `${binding.catalogKey}: ${issue.message}`,
        });
      }
    }
  })
  .describe(
    "One named catalog binding (ADR 0048 decision 4). `params` is validated against the " +
      "entry's own schema, which differs per `catalogKey` and today declares no fields for any " +
      "entry — zod-to-json-schema emits nothing for a refinement, so without this line the " +
      "document would promise that any record of scalars is accepted where the API answers 400 " +
      "(ADR 0029 Amendment 1). No entry may declare a uuid: an id inside `params` is an id " +
      "inside jsonb that no foreign key covers.",
  );

const DUPLICATE_SOURCE_MESSAGE =
  "the same catalog entry may not be bound twice on one widget " +
  "(dashboard_widget_sources_widget_key_key)";

/** Catches what `0054`'s own unique constraint would otherwise catch as a bare `23505`. */
const noDuplicateSources = (
  sources: { catalogKey: string }[],
  ctx: z.RefinementCtx,
): void => {
  const seen = new Set<string>();
  sources.forEach((source, index) => {
    if (seen.has(source.catalogKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "catalogKey"],
        message: DUPLICATE_SOURCE_MESSAGE,
      });
    }
    seen.add(source.catalogKey);
  });
};

/**
 * The per-type catalog-binding array, reading `WIDGET_SOURCE_CARDINALITY[type]` for the same
 * reason `pointsFieldFor` reads `WIDGET_POINT_CARDINALITY` — the 400 names the type and the
 * limit, and the number never drifts from the one the builder and the renderer read.
 *
 * `.default([])` so an existing client that has never heard of catalog bindings keeps working:
 * every widget type's minimum is 0, so an omitted array is a legal widget, and `F3.1c`'s saved
 * dashboards must not start failing a `PUT` because a field was added.
 */
const sourcesFieldFor = (widgetType: z.infer<typeof widgetTypeSchema>) => {
  const { min, max } = WIDGET_SOURCE_CARDINALITY[widgetType];
  return z
    .array(sourceBindingWriteSchema)
    .min(min, `a ${widgetType} widget requires at least ${min} catalog binding(s)`)
    .max(max, `a ${widgetType} widget accepts at most ${max} catalog binding(s)`)
    .superRefine(noDuplicateSources)
    // `.describe()` immediately after the refinement, `.default()` after that. Ordering is
    // checked, not merely presence: a description placed before the refinement lands on the
    // inner schema and is silently discarded.
    .describe(
      `Between ${min} and ${max} named catalog binding(s) for a ${widgetType} widget (ADR 0048 ` +
        "decision 4). Omitted means none. The same catalog entry may not be bound twice, which " +
        "is dashboard_widget_sources_widget_key_key in SQL — this gives a 400 naming the field " +
        "rather than a 500 carrying a constraint name.",
    )
    .default([]);
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
      sources: sourcesFieldFor("radial_gauge"),
    })
    .strict(),
  z
    .object({
      ...widgetIdentityWriteFields,
      widgetType: z.literal("tank_level"),
      config: tankLevelConfigSchema.strict(),
      points: pointsFieldFor("tank_level"),
      sources: sourcesFieldFor("tank_level"),
    })
    .strict(),
  z
    .object({
      ...widgetIdentityWriteFields,
      widgetType: z.literal("value_tile"),
      config: valueTileConfigSchema.strict(),
      points: pointsFieldFor("value_tile"),
      sources: sourcesFieldFor("value_tile"),
    })
    .strict(),
  z
    .object({
      ...widgetIdentityWriteFields,
      widgetType: z.literal("chart"),
      config: chartConfigSchema.strict(),
      points: pointsFieldFor("chart"),
      sources: sourcesFieldFor("chart"),
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
/**
 * `F3.35` Stage C — exactly one binding kind per widget.
 *
 * **On the array, not on an arm, and for a mechanical reason rather than a preference.** This
 * reads two sibling fields (`points` and `sources`) of one widget, which makes it a `.refine()`
 * on the object — and `z.discriminatedUnion` accepts only plain `ZodObject` arms, so a refined
 * arm cannot be a member. `eachWidgetFitsTheGrid` sits here for the same reason and the file
 * docblock states the rule.
 *
 * Both halves matter, and they fail differently. **Neither** kind bound is the state
 * `value_tile`'s old `min: 1` used to refuse before Stage C relaxed it — a widget that saves,
 * loads and draws an empty rectangle. **Both** kinds bound is the new one: a tile with a point
 * and a metric has two answers for one number, and picking either silently would put a value on
 * screen that the author never chose.
 *
 * The message templates come from `@bms/shared` so this 400 and the builder's inline error read
 * as one problem.
 */
const exactlyOneBindingKind = (
  widgets: { widgetType: string; points: unknown[]; sources: unknown[] }[],
  ctx: z.RefinementCtx,
): void => {
  widgets.forEach((widget, index) => {
    if (widget.points.length === 0 && widget.sources.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "points"],
        message: bindingRequiredMessage(widget.widgetType),
      });
    }
    if (widget.points.length > 0 && widget.sources.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "points"],
        message: bindingExclusiveMessage(widget.widgetType),
      });
    }
  });
};

const widgetsWriteFieldSchema = z
  .array(widgetWriteSchema)
  .max(MAX_DASHBOARD_WIDGETS)
  // ONE `.superRefine` calling two rules, not two chained calls. ADR 0029 decision 10 requires a
  // `.describe()` IMMEDIATELY after a refinement, and only the last link of a chain can have one
  // — so chaining would leave the grid rule undocumented in the generated document while the API
  // still enforced it. The two rules stay separate functions; only the call site is shared.
  .superRefine((widgets, ctx) => {
    eachWidgetFitsTheGrid(widgets, ctx);
    exactlyOneBindingKind(widgets, ctx);
  })
  .describe(
    `At most ${MAX_DASHBOARD_WIDGETS} widgets. Each must fit inside the ${DASHBOARD_GRID.columns}-column ` +
      `canvas (gridX + gridW <= ${DASHBOARD_GRID.columns}), the same bound ` +
      "dashboard_widgets_grid_bounds_check enforces in SQL — this gives a 400 naming the field " +
      "rather than a 500 carrying a constraint name. Each widget must also bind exactly one " +
      "KIND of source (ADR 0048 decision 4): a point or a named catalog entry, never both and " +
      "never neither — a widget binding neither draws an empty rectangle, and one binding both " +
      "has two answers for one number.",
  );

export const putDashboardWidgetsBodySchema = z
  .object({
    widgets: widgetsWriteFieldSchema,
  })
  .strict();

export type WidgetWriteBody = z.infer<typeof widgetWriteSchema>;
export type PutDashboardWidgetsBody = z.infer<typeof putDashboardWidgetsBodySchema>;
