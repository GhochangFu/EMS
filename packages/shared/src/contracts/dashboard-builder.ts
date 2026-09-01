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
 * **The axis is response versus request, not this file versus the rest of the directory —
 * every schema below is a RESPONSE contract, and none of them is `.strict()` because of that.**
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
 * The five widget types, closed (ADR 0047 decision 2; `"table"` added by ADR 0048 decision 5).
 *
 * **Two migrations declare this list, not one, and only the second is current.** `0050` froze
 * the original four in `dashboard_widgets_widget_type_check`; `F3.35` Stage B's `0055` drops
 * and re-adds that constraint with `table`. A committed migration is frozen by the pre-commit
 * hook, so `0050` still reads four and always will — which makes "match `0050`" the wrong
 * instruction and is why this sentence replaced it.
 *
 * `tests/f3.35-table-widget-schema.test.ts` compares this enum against `0055`'s widened list,
 * and `tests/f3.1a-dashboard-schema.test.ts` keeps pinning `0050` to its historical four. Both
 * are correct at once: the first asks what the database enforces now, the second what that
 * migration froze then.
 */
export const widgetTypeSchema = z.enum([
  "radial_gauge",
  "tank_level",
  "value_tile",
  "chart",
  "table",
]);

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
 * How a window of rolled-up telemetry collapses to one number — ADR 0048 decision 3.
 *
 * Four members, closed. **There is deliberately no `median` and no `last`**: the
 * ADR 0023 rollup relations store `sum_value`, `sample_count`, `min_value` and
 * `max_value`, and nothing else is recoverable from them. A fifth member here
 * would parse, reach `apps/api`, and find no column to read.
 *
 * `avg` is the one that has to be computed rather than selected —
 * `point-aggregates.ts`'s `avgExpr` is the only correct form, because an average
 * of bucket averages is wrong whenever the samples per bucket differ.
 */
export const pointAggregateFunctionSchema = z.enum(["sum", "avg", "min", "max"]);

/**
 * The icon a `value_tile` shows in its top-right corner — ADR 0048 decision 6's
 * "the tile's icon", as a **name**, never as markup.
 *
 * `KpiTile`'s `icon` prop is a `ReactNode` and config cannot carry one, so this
 * is a closed vocabulary whose name→SVG-path map lives in
 * `apps/web/src/lib/widget-catalog.ts` beside `WIDGET_CATALOG[…].iconPath`. That
 * is §4.8 as ADR 0032 rewrote it: an icon's behaviour is a path shipped in code,
 * so a seventh name declared by an `INSERT` would satisfy every constraint and
 * then render a blank square in front of an operator.
 *
 * The six are exactly the mock's KPI row
 * (`docs/ion-exchange-nexus-dashboard-2026-08-29.html`). Adding a seventh is a
 * code change by design, and `tests/f3.35-tile-icon-vocabulary.test.ts` holds
 * this enum and that map to the same set.
 */
export const widgetIconSchema = z.enum([
  "alert",
  "clipboard",
  "bolt",
  "drop",
  "recycle",
  "gauge",
]);

/**
 * The longest window a widget may ask for, in minutes — one year.
 *
 * Declared once because `F3.35` gives the tile the same bound the chart has
 * carried since `F3.1a`. **Do not narrow it**: §4.8 forbids a response contract
 * refusing a row the store can hold, and dashboards created before this change
 * may already carry a `windowMinutes` up to this value.
 */
export const MAX_WIDGET_WINDOW_MINUTES = 525_600;

/**
 * The canvas, declared once. `F3.1d`'s builder clamps to these numbers rather
 * than restating them, and `apps/api`'s write schema reads them too — the same
 * discipline `WIDGET_POINT_CARDINALITY` established (Amendment 2 §1): a bound
 * enforced only by the surface that happens to be convenient is not enforced.
 *
 * `0050`'s `dashboard_widgets_grid_bounds_check` is the fourth site and cannot
 * import this — SQL has no imports. `tests/f3.1d-grid-bounds-single-source.test.ts`
 * is the scan that keeps a FIFTH from appearing in TypeScript.
 */
export const DASHBOARD_GRID = {
  columns: 12,
  minWidgetW: 1,
  minWidgetH: 1,
  maxWidgetH: 24,
} as const;

/**
 * Fields every config carries. A plain object, spread into each arm — see the file docblock
 * for why this cannot be a schema.
 *
 * Exported (`F3.1b`) so `apps/api`'s strict write-side gauge config can spread it too, rather
 * than restating two field schemas a third time. Object spread is not a Zod combinator, so
 * re-exporting a plain object trips neither the ADR 0030 scan nor
 * `tests/f3.1a-dashboard-schema.test.ts`.
 */
export const commonConfigFields = {
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

export const radialGaugeConfigSchema = radialGaugeConfigObjectSchema
  .refine(gaugeRangeIsOrdered, {
    message: GAUGE_RANGE_MESSAGE,
    path: ["max"],
  })
  // AFTER the refinement — ADR 0029 Amendment 1 fact F. This refinement was
  // unreachable from the OpenAPI registry until `F3.36` registered a route whose
  // body embeds a widget config, so the gap surfaced there rather than here.
  // Same shape as the `envelopes.ts` list-schema gap the same row found: not an
  // API change, just a description that had never been needed.
  .describe(
    `A radial gauge's configuration. One rule the document cannot express: ${GAUGE_RANGE_MESSAGE}.`,
  );

/** A tank level: an SVG fill illustration plus a percentage, the §7 *Key Parameters* shape. */
export const tankLevelConfigSchema = z
  .object({
    ...commonConfigFields,
    fullScale: z.number().positive(),
    fillTone: widgetToneSchema.optional(),
  });

/**
 * A plain value-and-unit tile — the `kpi-tile.tsx` shape.
 *
 * **`F3.35` Stage A added six fields, and every one of them is FLAT. That is a
 * rule, not a style.** Both write surfaces compose this schema with `.strict()`
 * — `apps/api/src/dashboard-builder/dashboards.schema.ts` and
 * `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts` — and
 * **`.strict()` does not descend**. A nested `compare: z.object({ … })` would
 * leave its inner object permissive on both write paths, which is exactly why
 * `dashboards.schema.ts` had to restate the gauge `thresholds[]` array. Keeping
 * every field flat is what lets those two files stay untouched.
 *
 * `aggregate` absent means the tile keeps its original behaviour — the latest
 * live reading — so nothing already stored changes meaning.
 */
export const valueTileConfigSchema = z
  .object({
    ...commonConfigFields,
    abbreviate: z.boolean().optional(),
    /** How to collapse the window. Absent = show the latest live sample instead. */
    aggregate: pointAggregateFunctionSchema.optional(),
    /** The window to aggregate over, in minutes. Only read when `aggregate` is set. */
    windowMinutes: z.number().int().positive().max(MAX_WIDGET_WINDOW_MINUTES).optional(),
    /**
     * Show the *vs yesterday* delta against the immediately preceding window of
     * the same length.
     *
     * **A boolean, not a second window length.** Two windows of different lengths
     * make a percentage delta meaningless, and the mock asks for one period back.
     */
    compareToPrevious: z.boolean().optional(),
    icon: widgetIconSchema.optional(),
    /**
     * The tile's sub-line, author-typed.
     *
     * **One slot, with a stated precedence**: when `compareToPrevious` is set and
     * a delta is computable, the computed delta takes this slot and `hint` is not
     * rendered. `KpiTile` shows it at 11px on one line and the mock shows one.
     */
    hint: z.string().max(120).optional(),
    tone: widgetToneSchema.optional(),
  });

/**
 * The generic chart. `windowMinutes` defaults to a day, which is §7's "24-hour area chart"
 * expressed as configuration rather than as its own widget type.
 */
export const chartConfigSchema = z
  .object({
    ...commonConfigFields,
    series: chartSeriesKindSchema,
    windowMinutes: z.number().int().positive().max(MAX_WIDGET_WINDOW_MINUTES).optional(),
    stacked: z.boolean().optional(),
    yAxisLabel: z.string().max(64).optional(),
    /**
     * Plot the series as **rolled-up buckets** rather than raw readings — ADR
     * 0048 decision 3, which names this schema alongside the tile's.
     *
     * Absent means the chart reads raw recent readings exactly as it did before
     * `F3.35`, so no stored row changes meaning. Set, and the series comes from
     * the aggregate endpoint at a granularity the window chooses.
     */
    aggregate: pointAggregateFunctionSchema.optional(),
    /**
     * Show the Peak / Average / Granularity footer under the plot.
     *
     * Independent of `aggregate` in the schema because the footer's statistics
     * are the *scalar* half of the same response, which a raw-plotting chart can
     * still ask for. The renderer decides what it needs.
     */
    footerStats: z.boolean().optional(),
  });

/**
 * A ceiling on `tableConfigSchema.columns`, and deliberately not the real bound.
 *
 * The real bound is the bound dataset's own `METRIC_CATALOG[key].columns`, which is a
 * cross-field rule between `config` and `sources` and therefore lives on the write path
 * (`dashboards.schema.ts`), exactly where `eachSourceFitsTheWidget` lives. This number only
 * refuses an absurd payload before that rule runs, so it is set above the longest declared
 * list (six, `workorders.open`) with headroom rather than at it — tightening it to six would
 * make a future seven-column dataset fail here with a message about a limit instead of there
 * with a message about the dataset.
 */
export const MAX_TABLE_COLUMNS = 12;

/**
 * The `table` widget (`F3.35` Stage B, ADR 0048 decision 5).
 *
 * **`columns` is a projection, never a query.** The resolve endpoint returns every column the
 * catalog declares and the renderer picks from them (ADR 0048 decision 2), so no column name
 * travels in a request and no SQL is built from one. That is why this is a plain string array
 * and not an enum: the legal values depend on which dataset the widget binds, which this
 * schema cannot see.
 *
 * **Absent or empty means every declared column**, and that is load-bearing rather than
 * lenient. `WIDGET_SOURCE_CARDINALITY.table` is `{min: 1, max: 1}`, so an author binds the
 * dataset and picks columns in one save; a config that refused an empty list would make the
 * widget unsaveable at the moment it is created. It also keeps a stored table working when a
 * released catalog change adds a column — the card widens instead of going blank.
 *
 * Flat, for the reason `valueTileConfigSchema`'s docblock gives: both write surfaces compose
 * these with `.strict()`, and `.strict()` does not descend.
 */
export const tableConfigSchema = z.object({
  ...commonConfigFields,
  columns: z.array(z.string().max(64)).max(MAX_TABLE_COLUMNS).optional(),
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
  z.object({ widgetType: z.literal("table"), config: tableConfigSchema }),
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
 * How many widgets one dashboard may hold. Enforced by `F3.1b`'s write path, not by the
 * database, for the same reason `MAX_WIDGET_POINTS` is not: a per-dashboard row count is not
 * something a row-level `CHECK` can see.
 *
 * Moved here from `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts`
 * (`F3.1a` left it local because the live dashboard table did not exist yet) and exported so
 * that file imports it rather than keeping a second copy the two write paths could drift
 * apart on — the same discipline that file's `MAX_WIDGET_POINT_KEYS` comment already states.
 */
export const MAX_DASHBOARD_WIDGETS = 40;

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
  // `F3.35` Stage C lowered this from `{min: 1}`. ADR 0048 decision 2 gives the tile a second
  // binding kind — "a `value_tile` binds a metric" — so a tile with no point is now a legal
  // authored state rather than a broken one. The rule that replaces the old minimum is
  // *exactly one kind*, and it lives on write in `dashboards.schema.ts`, not here: it is a
  // cross-field rule between `points` and `sources`, which a per-type number cannot express.
  value_tile: { min: 0, max: 1 },
  chart: { min: 1, max: MAX_WIDGET_POINTS },
  // `F3.35` Stage B. A table draws a catalog **dataset** and nothing else: a bound point is a
  // series over time, which has no rows and no columns to project. `{min: 0, max: 0}` here and
  // `{min: 1, max: 1}` in `WIDGET_SOURCE_CARDINALITY` are the two halves of that one statement,
  // and together they make the exactly-one-binding-kind rule resolve to "a source, always".
  table: { min: 0, max: 0 },
};

/**
 * How many **catalog sources** each type may bind (`F3.35` Stage C, ADR 0048 decisions 1 and 2).
 *
 * The second half of `WIDGET_POINT_CARDINALITY`'s seam, and here for the same reason: `F3.1b`'s
 * successor must refuse a two-source tile *on write*, and `apps/api` cannot import from
 * `apps/web`. Presentation — the labels an author reads — stays in
 * `apps/web/src/lib/metric-catalog.ts`.
 *
 * **Why every value but the tile's is zero.** A gauge, a tank and a chart all draw a *series
 * over time*, and a catalog entry resolves to a number or to rows — neither is a series. Only
 * the tile shows a single current number, which is why decision 2 names it. Stage B's `table`
 * is the second non-zero entry, at `{min: 1, max: 1}`.
 *
 * The `Record` over the enum is what makes Stage B's fifth widget type a compile error here
 * rather than a widget that silently binds no source and renders nothing.
 */
export const WIDGET_SOURCE_CARDINALITY: Record<
  z.infer<typeof widgetTypeSchema>,
  { readonly min: number; readonly max: number }
> = {
  radial_gauge: { min: 0, max: 0 },
  tank_level: { min: 0, max: 0 },
  value_tile: { min: 0, max: 1 },
  chart: { min: 0, max: 0 },
  // `F3.35` Stage B, and the `min: 1` is the difference from every entry above it. A tile may
  // bind a point INSTEAD of a metric, so its minimum is zero; a table has no second way to get
  // rows, so a table with no source is not a partially-authored widget but an empty card.
  table: { min: 1, max: 1 },
};

/**
 * The two halves of the exactly-one-binding-kind rule, as message templates.
 *
 * **Here rather than in each surface, because two surfaces state the same rule and an author
 * meets both.** `apps/web`'s builder shows the first as an inline error while the author types;
 * `apps/api`'s `putDashboardWidgetsBodySchema` answers a 400 carrying the second if the form is
 * bypassed. Written independently, the two texts drift, and a 400 whose wording differs from the
 * inline error the author already read presents as a second, unrelated problem.
 *
 * The substitution differs on purpose and is not drift: the web passes the catalog's human label
 * ("Value Tile"), the API has only `widgetType` ("value_tile"). One template, two nouns.
 *
 * The rule itself is `WIDGET_POINT_CARDINALITY` and `WIDGET_SOURCE_CARDINALITY` read together —
 * a widget binds a point or a catalog entry, never both, and never neither.
 */
export const bindingRequiredMessage = (label: string): string =>
  `A ${label} widget needs a bound point or a named metric.`;

export const bindingExclusiveMessage = (label: string): string =>
  `A ${label} widget shows a bound point or a named metric, not both. Remove one.`;

/**
 * The metric catalog's keys, closed (`F3.35` Stage C, ADR 0048 decision 1).
 *
 * **The catalog is code, and that is the decision, not an implementation detail.** §4.8 as ADR
 * 0032 rewrote it asks whether a vocabulary's behaviour can be carried as data. A widget type's
 * behaviour is a React component; a catalog entry's behaviour is a **SQL query**, and no column
 * holds one either. An entry declared by an `INSERT` would satisfy every foreign key and then
 * return nothing, in front of an operator, with a green console.
 *
 * **What bounds the list, and keeps it short.** A derived point (`asset_points.kind`, ADR
 * 0036/0037) already lets an administrator declare a new *scalar* by formula without a release.
 * The catalog therefore carries only what a point cannot be: **row counts over operational
 * tables, and roll-ups across assets**. A number expressible as a formula over points is a
 * derived point, and a reviewer should refuse it here.
 *
 * Must match `dashboard_widget_sources_catalog_key_check` in migration `0054` exactly —
 * `tests/f3.35-metric-catalog-schema.test.ts` parses that `CHECK` and compares the two lists,
 * so drift fails the build rather than a page.
 *
 * **`assets.health.score` is here because its formula arrived.** ADR 0048 §7 listed it as
 * uncomputable, on the belief that the client still owed the roll-up formula from feature-sheet
 * row 12. That formula arrived on 2026-08-22 and shipped as `E1.3` / ADR 0050, so this entry
 * delegates to `AssetHealthService` rather than computing anything. Operational efficiency is
 * **not** here and must not be added until the client defines its numerator (ADR 0050 §B14) —
 * a key with no query is exactly the failure this vocabulary is closed to prevent.
 */
export const metricCatalogKeySchema = z.enum([
  "alarms.active.count",
  "alarms.active",
  "workorders.open.count",
  "workorders.open",
  "assets.health.score",
]);

/**
 * What each catalog entry resolves to (ADR 0048 decision 2).
 *
 * A **metric** resolves to one number; a **dataset** resolves to rows and a declared column
 * list. One vocabulary and two shapes, rather than two vocabularies, because the alarm *count*
 * and the alarm *table* must not be able to drift about what "active" means while both look
 * right.
 *
 * `columns` lives on the dataset arm only, so `shape` alone tells a reader which they hold —
 * no length check, and no empty array standing in for "not applicable". Stage B's column picker
 * chooses from this list; the resolve endpoint returns every declared column and the renderer
 * projects, so no column list travels in a request and no SQL is built from one.
 */
export type CatalogEntryMeta =
  | { readonly shape: "metric" }
  | { readonly shape: "dataset"; readonly columns: readonly string[] };

/**
 * The catalog itself — shape and declared columns, one entry per key.
 *
 * **No SQL and no label here.** The query belongs to `apps/api/src/metric-catalog/`, which is
 * the only place that can hold one; the label belongs to `apps/web`, which is the only place
 * that renders one. What lives here is what **both** sides must agree on, which is the same
 * split `WIDGET_POINT_CARDINALITY`'s docblock draws between a validation rule and presentation.
 *
 * The `Record` is compiler-forced, so a sixth key fails the build at this declaration rather
 * than resolving to `undefined` at a call site.
 */
export const METRIC_CATALOG: Record<z.infer<typeof metricCatalogKeySchema>, CatalogEntryMeta> = {
  "alarms.active.count": { shape: "metric" },
  "alarms.active": {
    shape: "dataset",
    columns: ["assetCode", "assetName", "severity", "message", "raisedAt"],
  },
  "workorders.open.count": { shape: "metric" },
  "workorders.open": {
    shape: "dataset",
    columns: ["assetCode", "assetName", "status", "priority", "title", "dueAt"],
  },
  "assets.health.score": { shape: "metric" },
};

/**
 * The ceiling on rows a dataset resolve returns.
 *
 * Declared here because two surfaces read it: the API clamps its `limit` to it, and the viewer
 * pages against it. A dataset is a **six-row card** on the mock, so 200 is a safety bound and
 * never a page size — a widget asking for more than a card can show is a defect in the widget,
 * not a reason to raise this.
 */
export const MAX_DATASET_ROWS = 200;

/**
 * Which catalog **shapes** each widget type can draw (`F3.35` Stage C).
 *
 * **`WIDGET_SOURCE_CARDINALITY` counts; this one types, and a count alone was not enough.**
 * `WIDGET_SOURCE_CARDINALITY.value_tile` is `{min: 0, max: 1}`, which a `dataset` entry
 * satisfies exactly as well as a `metric` one does. So `alarms.active` — rows and six declared
 * columns — passed every write bound onto a `value_tile`, stored, resolved as a dataset, and
 * arrived at a renderer that draws one number. Nothing threw: the tile rendered blank. This
 * record is what refuses it, on the write path where the count is already refused.
 *
 * **An empty array is a real member, not a gap.** A gauge, a tank and a chart draw a series
 * over time and accept no catalog shape at all, which is the same statement their `{min: 0,
 * max: 0}` cardinality makes, one axis over. Both are read: a type with `max: 0` never reaches
 * this map, and a type listed here with `max: 0` would still bind nothing.
 *
 * Stage B's `table` is the first entry to accept `"dataset"`, and the `Record` over the enum
 * is what makes forgetting to add it a compile error here rather than a table bound to a count.
 */
export const WIDGET_SOURCE_SHAPES: Record<
  z.infer<typeof widgetTypeSchema>,
  readonly CatalogEntryMeta["shape"][]
> = {
  radial_gauge: [],
  tank_level: [],
  value_tile: ["metric"],
  chart: [],
  // `F3.35` Stage B — the first entry to accept `"dataset"`, and it accepts ONLY that. The
  // mirror of the tile's hole: `alarms.active.count` satisfies `{min: 1, max: 1}` above exactly
  // as well as `alarms.active` does, and would arrive at a renderer that draws rows with one
  // number and no columns. Refused here, on the write path, where the count is already refused.
  table: ["dataset"],
};

/**
 * The third binding message, for a catalog entry whose shape the widget cannot draw.
 *
 * Here beside `bindingRequiredMessage`/`bindingExclusiveMessage` and for the identical reason:
 * two surfaces state this rule and one author meets both, so the builder's inline error and the
 * API's 400 must read as one problem rather than two. The substitution differs the same way —
 * the web passes the catalog's human label, the API has only `widgetType`.
 *
 * Both arms are written now although only the first can fire today. Stage B's `table` fires the
 * second, and a message added at the same time as the widget type that needs it is a message
 * written to match that widget type rather than to match this sentence.
 */
export const bindingShapeMessage = (
  label: string,
  catalogKey: string,
  shape: CatalogEntryMeta["shape"],
): string =>
  shape === "dataset"
    ? `A ${label} widget shows one number, and "${catalogKey}" returns rows. Choose a metric.`
    : `A ${label} widget shows rows, and "${catalogKey}" returns one number. Choose a dataset.`;

/**
 * The fourth binding message: a `table` projecting a column its dataset does not declare
 * (`F3.35` Stage B).
 *
 * Here with the other three because two surfaces state it and one author meets both — and this
 * one is reachable in ordinary use rather than only by a hand-written payload. An author picks
 * four columns of `alarms.active`, then rebinds the widget to `workorders.open`: the source is
 * legal, its shape is legal, and the stored projection now names columns the new dataset has
 * never heard of. The builder catches it as the author rebinds; the API catches the same state
 * arriving from anywhere else.
 *
 * The message names the column AND the entry, because "that column does not exist" is not
 * actionable when the author is looking at a picker that offered it a moment ago.
 */
export const columnNotDeclaredMessage = (column: string, catalogKey: string): string =>
  `"${catalogKey}" does not have a column named "${column}". Choose from the columns it returns.`;

/**
 * The fifth binding message: the same column chosen twice on one table.
 *
 * Beside the other four because the same author meets it on both surfaces, and here rather than
 * only in `apps/api` for the reason `noDuplicateSources` is: a duplicate is a constraint-shaped
 * refusal, and it should read as one sentence whichever surface says it.
 */
export const duplicateColumnMessage = (column: string): string =>
  `"${column}" is already chosen. Each column appears once.`;

/**
 * One point binding. A row in `bms.dashboard_widget_points`, never an id inside JSON.
 *
 * **`sortOrder` carries no `.min(0)`, deliberately.** `sort_order integer NOT NULL DEFAULT 0`
 * permits a negative, so a bound here would reject a row the database is entitled to produce —
 * and §4.8's failure direction makes that throw in dev and test and log on every production
 * read. A response contract states what the store can hold; the write bound belongs to
 * `F3.1b`.
 *
 * **`assetId`/`pointKey`/`unit` widened in by `F3.1b`.** Without them a caller cannot build the
 * `pointRef` (`encodePointRef`) `GET /telemetry/points/:pointRef/recent` needs, and `F3.1c`
 * would need a second round trip per point just to render one binding. Bounds match
 * `bms.asset_points`' own columns exactly — `assetId` a uuid FK, `pointKey varchar(128)`,
 * `unit varchar(32)` nullable — because §4.8 forbids a response contract asserting what the
 * store cannot hold. This is also what makes `F3.1b`'s Task 5 organization guard load-bearing:
 * `assetId` is the value a caller turns straight into a `telemetry.*` read, so a foreign one
 * leaving this API is a cross-tenant telemetry read one HTTP call later.
 */
export const dashboardWidgetPointDtoSchema = z
  .object({
    id: z.string().uuid(),
    pointId: z.string().uuid(),
    role: widgetPointRoleSchema,
    sortOrder: z.number().int(),
    assetId: z.string().uuid(),
    pointKey: z.string().max(128),
    unit: z.string().max(32).nullable(),
  });

/**
 * One catalog binding. A row in `bms.dashboard_widget_sources` (`F3.35` Stage C, ADR 0048
 * decision 4).
 *
 * **A fourth table, not a widened `dashboard_widget_points`.** ADR 0047 decision 3 made
 * `point_id` a real foreign key with `ON DELETE CASCADE` so that retiring a sensor leaves a
 * widget with *countable* zero bindings rather than a stale id inside `jsonb`. Making
 * `point_id` nullable beside a `catalog_key` column would make a `NULL` mean either "a catalog
 * binding" or "a bug", with a `CHECK` the only thing telling them apart. **A catalog key is a
 * foreign key to nothing**, because the catalog is code — and a separate table says so instead
 * of hiding it behind a nullable column.
 *
 * **`params` carries no id.** A binding inherits the dashboard's scope
 * (`dashboards.location_id` / `asset_group_id`), so a location id inside `params` would be an id
 * in `jsonb` that no foreign key covers and no orphan check can report — the ADR 0019 problem
 * decision 4 exists to refuse, one field over.
 *
 * **What holds it, and what does not.** The database's
 * `dashboard_widget_sources_params_object_check` (migration `0054`) is a *floor*: it refuses a
 * scalar or an array at the top level and accepts `{"locationId": "<any uuid>"}`. The control is
 * `METRIC_CATALOG_PARAMS_WRITE` in `apps/api/src/dashboard-builder/dashboards.schema.ts` — one
 * `.strict()` schema per catalog entry, none declaring an id — and
 * `tests/f3.35-metric-catalog-containment.test.ts`, which scans that map and fails the build on
 * `.uuid(`, on the id spellings that evade it, and on any entry losing `.strict()`.
 *
 * **This paragraph once named two files that did not exist**, in the past tense, and this item's
 * migration review caught it. Written forward it is a specification; written backward it is a
 * false claim in a committed file, and nothing in the text tells a reader which they hold. If a
 * sentence here says a thing is enforced, open the file it names.
 *
 * **`sortOrder` carries no `.min(0)`**, for the reason `dashboardWidgetPointDtoSchema` states:
 * `sort_order integer NOT NULL DEFAULT 0` permits a negative, so a bound here would reject a
 * row the store is entitled to produce. The write bound belongs to the request schema.
 */
export const dashboardWidgetSourceDtoSchema = z
  .object({
    id: z.string().uuid(),
    catalogKey: metricCatalogKeySchema,
    params: z.record(z.union([z.string(), z.number(), z.boolean()])),
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

/**
 * One cell of a resolved dataset row.
 *
 * **A closed union, never `z.unknown()`.** §4.8 records what that costs and that this repo has
 * already paid it: `z.unknown()` produces an *optional* key, and `z.any()` and
 * `z.custom<unknown>()` behave identically — "do not spend an afternoon on it". Four types is
 * what a SQL projection can actually return once a timestamp is serialised, so naming them is
 * both stricter and cheaper.
 */
const datasetCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * A resolved catalog value, as `GET /api/v1/metric-catalog/:key` returns it (`F3.35` Stage C).
 *
 * `z.discriminatedUnion` on `shape`, so a mislabelled payload fails rather than narrowing into
 * the wrong arm and rendering an empty table. Two plain `z.object` arms — no `.merge()`, no
 * `.omit().extend()`, which ADR 0030 Amendment 1 bans inside `contracts/` because a flattened
 * schema still typechecks and only a source scan catches it.
 *
 * **`value` is nullable on the metric arm, deliberately.** An entry can legitimately resolve to
 * nothing: `E1.3` returns a null mean score when no tag carries a published threshold rule, and
 * `F4.69` is the open row for the seed gap that makes that the current state. Rendering a null
 * as `0` would put a fabricated number in front of an operator, which is the one failure this
 * contract must make impossible.
 *
 * **`truncated` is a field rather than an inference.** A caller cannot tell a dataset that has
 * exactly `MAX_DATASET_ROWS` rows from one that was cut off at it, and the difference decides
 * whether the card is showing the whole answer.
 */
export const metricCatalogValueDtoSchema = z.discriminatedUnion("shape", [
  z.object({
    shape: z.literal("metric"),
    key: metricCatalogKeySchema,
    value: z.number().nullable(),
    unit: z.string().nullable(),
  }),
  z.object({
    shape: z.literal("dataset"),
    key: metricCatalogKeySchema,
    columns: z.array(z.string()),
    rows: z.array(z.record(datasetCellSchema)),
    truncated: z.boolean(),
  }),
]);

/**
 * `GET /dashboards/:id/catalog-values` — every catalog binding on one dashboard, resolved.
 *
 * **Keyed by `sourceId`, and one request per dashboard rather than one per entry.** The viewer
 * holds one socket per page (ADR 0048's Consequences), and a per-entry route would be N round
 * trips for a page that already knows all N bindings from its own read.
 *
 * **The route lives on `/dashboards` because scope does.** A dashboard may be scoped to a
 * location or an asset group, and every entry has to be narrowed to it — a site dashboard whose
 * tile reads `alarms.active.count` must show the site's count, not the organization's. That
 * narrowing needs the dashboard row, which a `/metric-catalog/:key` route could never see. ADR
 * 0048 decision 3's "one new endpoint on `@Controller("telemetry")`" is the POINT-AGGREGATE
 * endpoint, shipped in Stage A; do not let that sentence pull this one onto that controller.
 *
 * A binding whose widget was deleted between the dashboard read and this call simply does not
 * appear. The viewer renders "no value" for a `sourceId` it does not get back, which is the same
 * state ADR 0047 decision 3 requires for a widget whose point bindings have cascaded to zero.
 */
export const dashboardCatalogValueDtoSchema = z.object({
  /**
   * The binding's own row id. Present because it is the truth about which row answered, and
   * **deliberately not what a viewer keys on** — see `widgetId`.
   */
  sourceId: z.string().uuid(),
  /**
   * The NATURAL key, and the pair a viewer must match on (correctness review, Medium).
   *
   * **`sourceId` is regenerated by every widget save.** `putWidgets` replaces a widget's
   * bindings rather than editing them — `DELETE` by `widget_id` then re-`INSERT` — and
   * `dashboard_widget_sources.id` is `defaultRandom()`, so renaming a tile mints a new
   * `sourceId` for an unchanged binding. The viewer holds two queries that refresh on
   * different schedules: the catalog read polls every minute, the dashboard read does not poll
   * at all. On a wall display that never receives focus, the catalog answers with new
   * `sourceId`s while the page still holds the old ones, and every tile silently falls to "no
   * value" — `status: "ready"`, `stale: false`, a confident wrong answer.
   *
   * `(widgetId, catalogKey)` survives that, because `putWidgets` preserves a widget's `id`
   * across a replace and `dashboard_widget_sources_widget_key_key` makes the key unique per
   * widget. It is the same property the point path already relies on: `pointRef` is
   * `assetId:pointKey`, a natural key, which is why that path was never exposed to this.
   */
  widgetId: z.string().uuid(),
  catalogKey: metricCatalogKeySchema,
  resolved: metricCatalogValueDtoSchema,
});

export const dashboardCatalogValuesResponseSchema = z.object({
  values: z.array(dashboardCatalogValueDtoSchema),
  /** When the resolve ran, so a viewer can show staleness without a second clock. */
  resolvedAt: z.string().datetime(),
});
