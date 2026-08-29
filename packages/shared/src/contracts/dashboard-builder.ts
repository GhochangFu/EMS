import { z } from "zod";

/**
 * `F3.1a` — the configurable-dashboard contract (ADR 0047).
 *
 * **Not `dashboards.ts`.** `./dashboard.ts` already holds the *fixed* control-room reads
 * (`locationDashboardDtoSchema`, `dashboardKpisSchema`), and two files one plural apart is how
 * the wrong one gets imported.
 *
 * ---
 *
 * **Why `widgetType` is a `z.enum` and not a code into a lookup table.**
 *
 * This is deliberately the opposite of ADR 0031 and ADR 0032, and §4.8 as ADR 0032 rewrote it
 * is what decides it: *a vocabulary is only closed if the behaviour cannot be carried as data.*
 * Severity's behaviour is `rank` and `tone` — two columns — so a level declared by an `INSERT`
 * arrives sortable and styled. A widget type's behaviour is **a React component**, and no
 * column holds one. A type declared by an `INSERT` would satisfy the foreign key, the API and
 * the save, then draw a blank rectangle in front of an operator with nothing in the console,
 * the log or the network tab. That is the `F4.43` failure through the opposite door, and worse
 * — an unstyled badge is still legible.
 *
 * The roadmap test was applied and does not change it: `F3.28`, `F3.32` and `F4.41` all intend
 * to add widget types, and every one of those additions ships a component, which is a code
 * change, which is §4.8's definition of closed.
 *
 * Catalog metadata — label, icon, default size, point cardinality, and the plain-label mapping
 * to ECharts series — is `F3.1c`'s frontend registry, not a table and not this file: the
 * catalog is presentation, and presentation is the frontend's (the `tone` precedent, one level
 * up).
 *
 * ---
 *
 * **Why the config arms repeat their common fields instead of sharing a base schema.**
 *
 * Two constraints close both DRY routes at once, from different directions, and a reader who
 * knows only one will "fix" the repetition and break the other:
 *
 *  1. ADR 0030 Amendment 1 bans the flattening combinators inside `contracts/` — they produce
 *     a type assignable to the intersection that is not it. `tests/adr-0030-contract-derivation.test.ts`
 *     is a source scan, so it fails the build rather than the type-check.
 *  2. `z.discriminatedUnion` accepts only `ZodObject` arms. So `z.intersection` — the encoding
 *     §4.8 *prescribes* for `A & B` — cannot build an arm either.
 *
 * The legal answer is a plain TypeScript object of field schemas, spread into each arm. Object
 * spread is not a Zod combinator: it produces one flat `ZodObject` and matches neither scan
 * pattern. `tests/f3.1a-dashboard-schema.test.ts` scans this file for the combinators.
 *
 * ---
 *
 * **Nothing here is `.strict()`, and that is the rule rather than an omission.**
 *
 * These are RESPONSE contracts (ADR 0030 decision 2), and §4.8 is explicit about the direction:
 * `checkResponse` returns the **original** payload, never `result.data`, because Zod strips
 * unknown keys and a validator that quietly edits what it validates is worse than none. A
 * strict response schema would make every field the server adds a hard failure in dev and test
 * — the opposite of what that rule protects. No schema in `contracts/` is strict, and this file
 * does not become the first.
 *
 * E7.1f's "a mutating request body refuses an unknown key" (commit `cf5e230`) is a different
 * axis: it governs `REQUEST_SCHEMAS`, policed by `apps/api/src/openapi/strict-body-ledger.spec.ts`.
 * `F3.1b` owns the request bodies for these tables and takes that obligation with them. Drafting
 * this file applied E7.1f's rule to responses by mistake, and the intersection is what caught it
 * — two strict halves each reject the other's keys, so `dashboardWidgetDtoSchema` parsed nothing
 * at all.
 */

/**
 * The four widget types, closed. Must match `dashboard_widgets_widget_type_check` in migration
 * `0050` exactly; the spec pins both lists so drift fails the build rather than a page.
 */
export const widgetTypeSchema = z.enum(["radial_gauge", "tank_level", "value_tile", "chart"]);

/**
 * The generic `chart` type's series (ADR 0047 decision 4).
 *
 * One component, four shapes. This is the only lever that lowers the release rate for a closed
 * vocabulary: a new *kind* is always a release, but "we want bars" is configuration. ECharts
 * renders all four from the same component, which is what makes it cheap.
 *
 * The builder shows these as plain labels — *Trend*, *Comparison bars*, *Scatter* — never as
 * ECharts series names. That mapping is `F3.1c`'s catalog.
 */
export const chartSeriesKindSchema = z.enum(["line", "area", "bar", "scatter"]);

/** Which slot of the renderer a bound point feeds. Mirrors `dashboard_widget_points_role_check`. */
export const widgetPointRoleSchema = z.enum(["primary", "series"]);

/** The presentation tone of a gauge threshold band. Closed, and owned by the frontend palette. */
export const widgetToneSchema = z.enum(["ok", "info", "warning", "critical"]);

/**
 * Fields every config carries. A plain object, spread into each arm — see the file docblock
 * for why this cannot be a schema.
 */
const commonConfigFields = {
  unit: z.string().max(32).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
};

/** At most this many bands on one gauge. Exported so `apps/api` can restate the array with a
 * strict item schema without restating the bound. */
export const MAX_GAUGE_THRESHOLDS = 8;

/** One coloured band on a radial gauge. */
export const gaugeThresholdSchema = z
  .object({
    value: z.number(),
    tone: widgetToneSchema,
  });

/**
 * A radial gauge. ECharts ships a `gauge` series, so this is configuration rather than drawing.
 *
 * Not merged into `chart` despite also being an ECharts series: its config surface — minimum,
 * maximum, thresholds, bands — is disjoint from a cartesian chart's, and merging them would put
 * two unrelated halves in one form in front of a non-programmer.
 */
export const radialGaugeConfigObjectSchema = z.object({
  ...commonConfigFields,
  min: z.number(),
  max: z.number(),
  thresholds: z.array(gaugeThresholdSchema).max(MAX_GAUGE_THRESHOLDS).optional(),
});

/**
 * An inverted or empty range gives the needle no defined position, so it is refused rather than
 * left for the renderer to guess — a guess renders something plausible and wrong.
 *
 * Exported as a **predicate**, not only as a built schema, because `.refine()` produces a
 * `ZodEffects` and `ZodEffects` has no `.strict()`. `apps/api` needs a strict gauge config for
 * the template authoring body (E7.1f), so it composes
 * `radialGaugeConfigObjectSchema.strict().refine(gaugeRangeIsOrdered, …)`. Declaring the rule
 * once as a function is what keeps that from becoming a second copy of it.
 */
export const gaugeRangeIsOrdered = (config: { min: number; max: number }): boolean =>
  config.max > config.min;

export const GAUGE_RANGE_MESSAGE = "max must be greater than min";

export const radialGaugeConfigSchema = radialGaugeConfigObjectSchema.refine(gaugeRangeIsOrdered, {
  message: GAUGE_RANGE_MESSAGE,
  path: ["max"],
});

/** A tank level: an SVG fill illustration plus a percentage, the §7 *Key Parameters* shape. */
export const tankLevelConfigSchema = z
  .object({
    ...commonConfigFields,
    fullScale: z.number().positive(),
    fillTone: widgetToneSchema.optional(),
  });

/** A plain value-and-unit tile — the `kpi-tile.tsx` shape. */
export const valueTileConfigSchema = z
  .object({
    ...commonConfigFields,
    abbreviate: z.boolean().optional(),
  });

/**
 * The generic chart. `windowMinutes` defaults to a day, which is §7's "24-hour area chart"
 * expressed as configuration rather than as its own widget type.
 */
export const chartConfigSchema = z
  .object({
    ...commonConfigFields,
    series: chartSeriesKindSchema,
    windowMinutes: z.number().int().positive().max(525_600).optional(),
    stacked: z.boolean().optional(),
    yAxisLabel: z.string().max(64).optional(),
  });

/**
 * Type and config as one value.
 *
 * **The discriminant is `widgetType`, which is the column, and it is stored once.**
 * `bms.dashboard_widgets.widget_type` holds it; `config` holds only the renderer-private half.
 * Nothing has to reconcile a discriminant inside the JSON against the column, because there is
 * none inside the JSON — the union is over the pair, not over `config` alone. That is what
 * keeps `F3.1c`'s exhaustive `switch` operating on the DTO directly.
 */
export const dashboardWidgetSpecSchema = z.discriminatedUnion("widgetType", [
  z.object({ widgetType: z.literal("radial_gauge"), config: radialGaugeConfigSchema }),
  z.object({ widgetType: z.literal("tank_level"), config: tankLevelConfigSchema }),
  z.object({ widgetType: z.literal("value_tile"), config: valueTileConfigSchema }),
  z.object({ widgetType: z.literal("chart"), config: chartConfigSchema }),
]);

/**
 * How many points one widget may bind. **Enforced by `F3.1b`'s write path, not by the
 * database** — cardinality is a per-widget row count and no row-level `CHECK` can see it.
 *
 * Exported so `F3.1b` uses this number rather than inventing a third: the template authoring
 * surface already caps a widget at `MAX_WIDGET_POINT_KEYS` in
 * `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts`, and the two must
 * agree or a template widget will not survive instantiation.
 */
export const MAX_WIDGET_POINTS = 8;

/**
 * How many points **each type** may bind (ADR 0047 Amendment 2).
 *
 * **This is the one catalog field that lives here rather than in `F3.1c`'s frontend registry,
 * and the reason is the consumer, not the data.** Decision 2 put label, icon, default size and
 * cardinality in `apps/web/src/lib/widget-catalog.ts` because the vocabulary is presentation
 * (the plain-label→ECharts series mapping is decision 4's, in the same file). Three of those
 * four still are. Cardinality is not: `F3.1b` must
 * refuse a two-point gauge *on write*, and `apps/api` cannot import from `apps/web`. The split
 * line is therefore **validation rule versus presentation**, not contract versus catalog.
 * `widget-catalog.ts` imports these numbers rather than restating them, so the write path and
 * the renderer cannot disagree about which dashboards are legal.
 *
 * **`min` is an authoring rule and never a stored invariant.** `dashboard_widget_points.point_id`
 * is `ON DELETE CASCADE`, so retiring a sensor can legitimately take a live gauge to zero
 * bindings. That state must stay *readable* — `F3.1c` renders it as "no data bound". A read path
 * that refuses or hides a widget with fewer than `min` bindings turns a retired sensor into a
 * missing dashboard.
 *
 * The type is a `Record` over the enum, so a fifth widget type fails the build here rather than
 * binding an unbounded number of points in silence.
 */
export const WIDGET_POINT_CARDINALITY: Record<
  z.infer<typeof widgetTypeSchema>,
  { readonly min: number; readonly max: number }
> = {
  radial_gauge: { min: 1, max: 1 },
  tank_level: { min: 1, max: 1 },
  value_tile: { min: 1, max: 1 },
  chart: { min: 1, max: MAX_WIDGET_POINTS },
};

/**
 * One point binding. A row in `bms.dashboard_widget_points`, never an id inside JSON.
 *
 * **`sortOrder` carries no `.min(0)`, deliberately.** `sort_order integer NOT NULL DEFAULT 0`
 * permits a negative, so a bound here would reject a row the database is entitled to produce —
 * and §4.8's failure direction makes that throw in dev and test and log on every production
 * read. A response contract states what the store can hold; the write bound belongs to
 * `F3.1b`.
 */
export const dashboardWidgetPointDtoSchema = z
  .object({
    id: z.string().uuid(),
    pointId: z.string().uuid(),
    role: widgetPointRoleSchema,
    sortOrder: z.number().int(),
  });

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
    title: z.string().max(255).nullable(),
    gridX: z.number().int().min(0).max(11),
    gridY: z.number().int().min(0),
    gridW: z.number().int().min(1).max(12),
    gridH: z.number().int().min(1).max(24),
    // No `.max()`: cardinality is a per-widget row count that no row-level CHECK can see, so
    // the database does not enforce it and a response contract must not claim it does. The cap
    // is `MAX_WIDGET_POINTS`, enforced by `F3.1b` on write. The grid bounds above are a
    // different case — `dashboard_widgets_grid_bounds_check` really does enforce those, so
    // stating them here cannot reject a row the store can hold.
    points: z.array(dashboardWidgetPointDtoSchema),
  })
  .refine((widget) => widget.gridX + widget.gridW <= 12, {
    message: "a widget must fit inside the 12-column canvas",
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
    createdAt: z.string(),
    updatedAt: z.string(),
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
    createdAt: z.string(),
    updatedAt: z.string(),
    widgetCount: z.number().int().min(0),
  });
