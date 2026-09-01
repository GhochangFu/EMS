import { z } from "zod";

import {
  DASHBOARD_GRID,
  dashboardDtoSchema,
  dashboardWidgetSpecSchema,
  MAX_DASHBOARD_WIDGETS,
  metricCatalogKeySchema,
  widgetPointRoleSchema,
} from "./dashboard-builder";
import { assetRoleCodeSchema } from "./operations";
import { templateLifecycleStatusSchema } from "./template-lifecycle";

/**
 * Section dashboard templates — `F3.36`, migration `0056`,
 * [ADR 0049](../../../../docs/adr/0049-section-dashboard-templates.md) with
 * Amendments 1 and 2.
 *
 * A **section template** is a versioned, publishable canvas whose widgets bind
 * an **asset-group role plus a point key** rather than an asset id, so one
 * authored canvas instantiates against any asset group — Sheet 02's *"the same
 * canvas bound to a different asset group"*.
 *
 * ---
 *
 * **ENCODING RULES (ADR 0030 Amendment 1, §4.8). A flattened schema still
 * typechecks, which is why they are named here rather than assumed.**
 *
 * - `A & B` is `z.intersection(a, b)`, never `.merge()`. `.merge()` flattens the
 *   two object types into one, which is *assignable to* the intersection and is
 *   not it. `dashboardWidgetDtoSchema` is the worked precedent, and the
 *   discriminated union still narrows through the intersection because
 *   `(Identity) & (A | B | C | D)` distributes.
 * - `Omit<A, k> & B` is `z.intersection(a.omit({…}), b)`, never
 *   `.omit().extend()`.
 * - A summary DTO is written as its own `z.object` rather than derived by
 *   omission, for the same reason. The repetition is the price of the rule.
 *
 * **Where `.min(1)` belongs, and where it does not.** The row's own `varchar`
 * columns — `code`, `name`, `section` — carry no lower bound: `varchar(64)`
 * accepts the empty string, so a bound here would reject a row the store can
 * hold, and the write bound is the request schema's. The fields inside
 * `content` are the opposite case: `content` is `jsonb`, so this schema **is**
 * the only thing that shapes it, exactly as `templateContentSchema` is for
 * `asset_templates.content`.
 */

// ---------------------------------------------------------------------------
// The section vocabulary
// ---------------------------------------------------------------------------

/**
 * A code into `bms.dashboard_sections`.
 *
 * **A bounded string and never a `z.enum`** — ADR 0049 Amendment 2 decision 5
 * makes the section vocabulary a lookup table, on §4.8's test as ADR 0032
 * rewrote it: a section's behaviour is "group these templates", which *is* the
 * code, so a section declared by an `INSERT` arrives fully functional. Sheet 02
 * says the same thing in product terms — *"adding a seventh is configuration,
 * not a release"*.
 *
 * The set is closed by the table and by `dashboard_templates_section_fkey`, not
 * by this file. The API boundary that turns an unknown code into a 400 is the
 * same one `assetRoleCodeSchema` uses. Do not paste the six seeded codes in
 * here because fetching them felt inconvenient — that is the revert
 * `tests/f3.37-asset-role-vocabulary.test.ts` was written to catch, one
 * vocabulary over.
 */
export const dashboardSectionCodeSchema = z.string().min(1).max(64);

/** One row of `bms.dashboard_sections`. Matches `assetRoleDtoSchema`'s shape —
 * no `tone` and no `rank`, because a section drives no styling and carries no
 * urgency. */
export const dashboardSectionDtoSchema = z.object({
  code: dashboardSectionCodeSchema,
  label: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number(),
  active: z.boolean(),
});

// ---------------------------------------------------------------------------
// What a template widget binds
// ---------------------------------------------------------------------------

/**
 * A role-plus-point-key binding — ADR 0049 decision 4.
 *
 * A widget says *"the incoming-supply meter's `kW`"*, never *"asset `7f3a`'s
 * `kW`"*. Instantiation resolves `assetRoleCode` against the target asset
 * group's members and binds each matching member's point with that key.
 *
 * **The field is `assetRoleCode`, not `role`.** `bms.dashboard_widget_points`
 * already has a `role`, and it means `primary | series` — a closed
 * renderer-slot vocabulary. Two different `role`s in one widget contract would
 * be misread by every reader, so the renderer slot is carried as `pointRole`
 * and reuses `widgetPointRoleSchema` rather than restating it.
 *
 * **`assetRoleCode` re-exports rather than restates**, and it must never become
 * a `z.enum`: the set lives in `bms.asset_roles` and
 * `VocabulariesService.assertAssetRole` is the boundary that turns an unknown
 * code into a 400. `tests/f3.37-asset-role-vocabulary.test.ts` fails the build
 * on the enum revert.
 */
export const sectionTemplateBindingSchema = z.object({
  assetRoleCode: assetRoleCodeSchema,
  /** Matches `template_points.point_key`'s width. Resolved against
   * `bms.asset_points.point_key` for each member the role matched. */
  pointKey: z.string().min(1).max(128),
  pointRole: widgetPointRoleSchema.default("primary"),
  sortOrder: z.number().int().default(0),
});

/**
 * A metric-catalog binding, which resolves with **no role at all**.
 *
 * A catalog entry inherits the instantiated dashboard's own scope, so it needs
 * no member to match — which is why four of Sheet 02's five Electrical KPI tiles
 * are this shape, and why `F3.36` depends on `F3.35`.
 *
 * `params` mirrors `dashboardWidgetSourceDtoSchema.params`. The write path
 * re-validates it through `METRIC_CATALOG_PARAMS_WRITE`;
 * `tests/f3.35-metric-catalog-containment.test.ts` scans that map for `.uuid(`
 * and for id spellings, because an id smuggled into `params` is an id inside
 * `jsonb` that no foreign key covers.
 */
export const sectionTemplateSourceSchema = z.object({
  catalogKey: metricCatalogKeySchema,
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  sortOrder: z.number().int().default(0),
});

/**
 * A template widget's own fields, without type or config.
 *
 * **`key` is a stable, template-local widget id, and it exists for the
 * resolution report.** Without it, *"widget 3 came up one short"* has nothing to
 * name, and ADR 0049 Amendment 2 decision 1 requires instantiation to name every
 * widget that did not fully resolve. It is authored, not generated, so it
 * survives a `createDraftFrom` and a stock re-import.
 *
 * The grid is bounded exactly as `dashboardWidgetIdentitySchema` bounds it, by
 * reading `DASHBOARD_GRID` rather than restating a number —
 * `tests/f3.1d-grid-bounds-single-source.test.ts` scans this file.
 */
export const sectionTemplateWidgetIdentitySchema = z
  .object({
    key: z.string().min(1).max(64),
    title: z.string().max(255).nullable().default(null),
    gridX: z.number().int().min(0).max(DASHBOARD_GRID.columns - 1),
    gridY: z.number().int().min(0),
    gridW: z.number().int().min(DASHBOARD_GRID.minWidgetW).max(DASHBOARD_GRID.columns),
    gridH: z.number().int().min(DASHBOARD_GRID.minWidgetH).max(DASHBOARD_GRID.maxWidgetH),
    /** No `.max()`: the per-type cap is `WIDGET_POINT_CARDINALITY`, applied at
     * instantiation against the resolved member count, not to the authored
     * bindings — one binding can resolve to eight points. */
    bindings: z.array(sectionTemplateBindingSchema).default([]),
    sources: z.array(sectionTemplateSourceSchema).default([]),
  })
  .refine((widget) => widget.gridX + widget.gridW <= DASHBOARD_GRID.columns, {
    message: `a widget must fit inside the ${DASHBOARD_GRID.columns}-column canvas`,
    path: ["gridW"],
  });

/**
 * One widget of a section template.
 *
 * `z.intersection` and not `.merge()` — see the file docblock. The widget type
 * and its config come from `dashboardWidgetSpecSchema` unchanged, because a
 * template widget renders through exactly the same components as a dashboard
 * widget; only the *binding* differs.
 */
export const sectionTemplateWidgetSchema = z.intersection(
  sectionTemplateWidgetIdentitySchema,
  dashboardWidgetSpecSchema,
);

/**
 * A template's `content` — the whole authored canvas.
 *
 * The widget cap is `MAX_DASHBOARD_WIDGETS`, read rather than restated, so an
 * instantiated dashboard cannot exceed what the dashboard write path accepts.
 *
 * `key` uniqueness is enforced here because the resolution report addresses
 * widgets by `key`: two widgets sharing one would make *"this widget is short"*
 * ambiguous at exactly the moment an administrator needs it to be precise.
 */
export const sectionTemplateContentSchema = z
  .object({
    widgets: z.array(sectionTemplateWidgetSchema).max(MAX_DASHBOARD_WIDGETS).default([]),
  })
  .superRefine((content, ctx) => {
    const seen = new Set<string>();
    content.widgets.forEach((widget, index) => {
      if (seen.has(widget.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate widget key "${widget.key}" — keys address widgets in the resolution report and must be unique within a template`,
          path: ["widgets", index, "key"],
        });
      }
      seen.add(widget.key);
    });
  });

// ---------------------------------------------------------------------------
// The template rows
// ---------------------------------------------------------------------------

/** A section template version, with its content. */
export const dashboardTemplateDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  // No `.min(1)` on the varchar columns — see the file docblock.
  code: z.string().max(64),
  version: z.number().int(),
  name: z.string().max(255),
  section: dashboardSectionCodeSchema,
  description: z.string().nullable(),
  status: templateLifecycleStatusSchema,
  content: sectionTemplateContentSchema,
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  /** ADR 0049 decision 3 — which release of the repository catalog this row was
   * imported from. Both null for a hand-authored template;
   * `dashboard_templates_stock_stamp_check` holds that they move together. */
  stockCode: z.string().max(64).nullable(),
  stockVersion: z.number().int().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** A template in a list, without its content. Its own `z.object` — see the file
 * docblock on why this is not derived by omission. */
export const dashboardTemplateSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  code: z.string().max(64),
  version: z.number().int(),
  name: z.string().max(255),
  section: dashboardSectionCodeSchema,
  description: z.string().nullable(),
  status: templateLifecycleStatusSchema,
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  stockCode: z.string().max(64).nullable(),
  stockVersion: z.number().int().nullable(),
  widgetCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * One entry of the stock catalog as listed — ADR 0049 decision 3.
 *
 * The catalog lives **outside the tenant tables** and is *imported* into a real
 * row the organization then owns. It carries no `organizationId` and no `id`,
 * because it is repository data rather than a row: the import creates the row.
 *
 * Each entry carries its **own** `stockVersion`, not one catalog-wide number, so
 * improving the Electrical default does not renumber the other five.
 */
export const stockDashboardTemplateDtoSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  section: dashboardSectionCodeSchema,
  description: z.string().nullable(),
  stockVersion: z.number().int().positive(),
  content: sectionTemplateContentSchema,
});

// ---------------------------------------------------------------------------
// Instantiation: the resolution report
// ---------------------------------------------------------------------------

/**
 * What became of one widget's bindings at instantiation — ADR 0049 decision 6
 * and **Amendment 2 decisions 1 to 4**.
 *
 * **Closed, and this is the one vocabulary in this file that is.** §4.8's test as
 * ADR 0032 rewrote it asks whether the behaviour can be carried as data. A
 * section's behaviour is its code and a role's is "match this member", so both
 * are open. An outcome's behaviour is a **distinct affordance the UI draws** —
 * four different things an administrator is told and can act on — so a fifth
 * code declared anywhere would arrive with nothing to render it. That is
 * `dashboard_widget_points.role`'s case, not `asset_roles`'.
 *
 * It is never stored, so it needs no `CHECK` and no lookup table.
 */
export const TEMPLATE_WIDGET_RESOLUTION_OUTCOMES = [
  /** Every member the role matched was bound. */
  "bound",
  /** More members matched than the widget can hold; the surplus was dropped. */
  "truncated",
  /** The role matched, but some members carry no point with that key. */
  "partial",
  /** The role matched nothing. The widget arrives with zero bindings and
   * renders "no data bound" — ADR 0049 decision 6, never a failed import. */
  "unresolved",
] as const;

export const templateWidgetResolutionOutcomeSchema = z.enum(
  TEMPLATE_WIDGET_RESOLUTION_OUTCOMES,
);

/**
 * **Instantiation never succeeds silently** — Amendment 2 decision 1, and the
 * load-bearing half of that amendment.
 *
 * A future reader may disagree with decision 2's tie-break (first member by
 * `assets.code`) and change it. This report is not theirs to drop: it is what
 * turns *"the gauge shows one of three chillers"* from something nobody notices
 * into something the instantiate dialog names. `F3.37` shipped `roleCounts` for
 * the same reason one level down.
 *
 * `.readonly()` because nothing mutates a report.
 */
export const templateWidgetResolutionDtoSchema = z
  .object({
    /** `sectionTemplateWidgetIdentitySchema.key` — which widget this is about. */
    widgetKey: z.string(),
    assetRoleCodes: z.array(assetRoleCodeSchema),
    /** How many asset-group members the widget's roles matched. */
    matchedMembers: z.number().int(),
    /** How many points were actually bound. Less than `matchedMembers` means
     * `truncated` or `partial`, and the difference is the shortfall. */
    boundPoints: z.number().int(),
    outcome: templateWidgetResolutionOutcomeSchema,
  })
  .readonly();

/** The response of `POST /admin/dashboard-templates/:id/instantiate`: the
 * dashboard that was created, and what became of every widget. */
export const instantiateSectionTemplateResponseSchema = z.object({
  dashboard: dashboardDtoSchema,
  resolutions: z.array(templateWidgetResolutionDtoSchema),
});
