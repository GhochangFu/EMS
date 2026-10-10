/**
 * Asset template contracts (ADR 0015, ADR 0019; `F2.6` / ADR 0039) — template
 * and stock-template DTOs, the instantiate result, and the per-asset calc
 * override and calc config of a derived point.
 *
 * Moved out of `admin.ts` whole by `F4.150` (AGENTS.md §4.5), byte-identical.
 * Neither file imports the other. `template-migration.ts` imports from here.
 *
 * `adminAssetTemplateSummaryDtoSchema` is the second site where ADR 0030
 * Amendment 1's encoding rules bite: the exported type is
 * `Omit<AdminAssetTemplateDto, "points"> & { pointCount: number }`, so it is
 * `z.intersection(base.omit(…), …)` and NOT `.omit().extend()`, which flattens.
 */
import { z } from "zod";

import { CALC_DIALECTS, CALC_TRIGGERS } from "../calc-dsl";
import { instantiatedDashboardDtoSchema } from "./asset-dashboards";
import { templateLifecycleStatusSchema } from "./template-lifecycle";
import { pointMetadataFieldsSchema, pointMetadataShape } from "./point-metadata";
import { pointSourceKindSchema } from "./telemetry-entry";

/**
 * Lifecycle of an asset template version (ADR 0015).
 *
 * **Re-exported, never restated** — ADR 0049 decision 2 declares the vocabulary
 * once in `./template-lifecycle`, because `bms.dashboard_templates` runs the
 * same lifecycle and a second `z.enum` here would drift the day either gains a
 * fourth state. §4.8: re-export rather than restate.
 * `tests/f3.36-template-lifecycle-single-source.test.ts` holds it.
 */
export const assetTemplateStatusSchema = templateLifecycleStatusSchema;

/**
 * Whether instantiation emits an `asset_points` row for this point.
 *
 * `derived` points are computed by the calc engine (F2.6) and deliberately
 * produce no mapping row — `asset_points.source_data_key` is NOT NULL and there
 * is no honest source key for a computed tag.
 */
export const templatePointKindSchema = z.enum(["measured", "derived"]);

/**
 * Which calc grammar a stored `formula` was written in — `bms-calc-v1`
 * (ADR 0036) or `bms-calc-v2` (ADR 0055 decision 2).
 *
 * **Declared once, from `CALC_DIALECTS`, and re-used at every site.** Three
 * schemas in this file carry a `formulaDialect`, and `apps/api` carries two
 * more; each of them pinned the `v1` constant with a bare Zod literal until
 * `F2.9`. Re-inlining one is the §4.8 "nobody restates a vocabulary" failure in
 * its worst form here: one endpoint silently refuses a dialect every other
 * endpoint accepts, so the same stored row reads back on one page and 400s on
 * another. `tests/adr-0055-calc-v2-invariants.test.ts` part (c) is the guard —
 * it scans raw source, so do not spell that literal even inside a comment.
 */
export const calcDialectSchema = z.enum(CALC_DIALECTS);

/**
 * `F2.13` / ADR 0052 decision 2, ADR 0040 open question 4 — the tier marking
 * a point carries (tag-list `C` -> `core`, `X` -> `extended`), what makes a
 * client's redline mechanical. `.partial()`, not a bare `{ tier }` object:
 * `bms.template_points.meta jsonb NOT NULL DEFAULT {}` may hold `{}` — the
 * column's own default, for a point with no provenance yet — not only the
 * full shape `apps/api`'s write-side `templatePointBodySchema` requires when
 * `meta` is supplied at all. Read-side, so it must not reject a row the
 * database holds, matching every other field on `adminTemplatePointDtoSchema`.
 */
const templatePointMetaDtoSchema = z
  .object({ tier: z.enum(["core", "extended", "manual"]) })
  .partial()
  .strict()
  .nullable();

export const adminTemplatePointDtoSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  pointKey: z.string(),
  label: z.string().nullable(),
  /** Override; `null` means "use the point-key catalog's unit". */
  unit: z.string().nullable(),
  kind: templatePointKindSchema,
  sourceDataKeyPattern: z.string().nullable(),
  // ADR 0036 decisions 5 and 7. Both null for a measured point; both set for a
  // derived one (enforced in apps/api's templatePointBodySchema, not here —
  // this is a read-side DTO).
  formula: z.string().nullable(),
  formulaDialect: calcDialectSchema.nullable(),
  // ADR 0037 decision 4. Read-side counterpart of the enforcement in
  // apps/api's templatePointBodySchema — carried here for the same reason
  // formula/formulaDialect are: templatePointsBodySchema sends the whole
  // points array on every draft update, so an editor round-tripping a GET
  // response back through PATCH must see these fields or lose them.
  calcTrigger: z.enum(CALC_TRIGGERS).nullable(),
  calcIntervalSeconds: z.number().nullable(),
  maxInputAgeSeconds: z.number().nullable(),
  // ADR 0055 decision 11 (`F2.9`). `null` is "fail closed" — every declared
  // member of an aggregate must be fresh — and NOT "no limit"; the column is
  // nullable for exactly that reading. **No `(0, 1]` bound here**, for the same
  // reason `calcIntervalSeconds` carries none: this is a read-side DTO over
  // stored rows, and a read schema that rejects a row the database holds is a
  // schema that lies about the estate. The bound lives on the write side, in
  // apps/api's `templatePointBodySchema`.
  minCoverageRatio: z.number().nullable(),
  required: z.boolean(),
  sortOrder: z.number(),
  meta: templatePointMetaDtoSchema,
  createdAt: z.string(),
  // `F2.7` / ADR 0056 decision 1 — the class **default** of the five metadata
  // columns; `null` = none set. Read-side, no bounds (`point-metadata.ts`).
  // Carried for the reason the calc fields above are: the Points tab
  // round-trips the whole point set, and must see these or lose them.
  ...pointMetadataShape,
});

/**
 * One template *version* (ADR 0015) — a row is a version, so
 * `assets.templateId` pins it exactly and the two can never disagree.
 */
export const adminAssetTemplateDtoSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationCode: z.string(),
  organizationName: z.string(),
  code: z.string(),
  version: z.number(),
  name: z.string(),
  assetType: z.string(),
  domain: z.string(),
  description: z.string().nullable(),
  status: assetTemplateStatusSchema,
  /**
   * The `E1.7` overlay. A bare record rather than `TemplateContent` on purpose:
   * `F2.1` shipped this column behind `z.record(z.unknown())`, so a deployment
   * may hold rows written before ADR 0019 tightened it. Those rows still read
   * and still instantiate — nothing consumes `content` — and are rejected only
   * when someone next writes or publishes them. A DTO claiming `TemplateContent`
   * would be lying about them.
   */
  content: z.record(z.unknown()),
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  /**
   * `F2.13` / ADR 0052 — which stock release this row was imported from, or
   * both `null` for a hand-authored template. Column for column with
   * `dashboard-templates.ts`'s `dashboardTemplateSummaryDtoSchema.stockCode`
   * / `.stockVersion`.
   */
  stockCode: z.string().max(64).nullable(),
  stockVersion: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  points: z.array(adminTemplatePointDtoSchema),
});

/**
 * List rows omit `points` — the editor fetches them per template.
 *
 * `z.intersection`, never `.omit().extend()` — ADR 0030 Amendment 1, rule 2.
 */
export const adminAssetTemplateSummaryDtoSchema = z.intersection(
  adminAssetTemplateDtoSchema.omit({ points: true }),
  z.object({ pointCount: z.number() }),
);

/**
 * One point of a stock catalog entry — `F2.13` / ADR 0052 decision 2.
 *
 * **The write shape, not the read shape.** `adminTemplatePointDtoSchema`
 * carries `id` / `templateId` / `createdAt`, which repository data — a
 * TypeScript literal in `apps/api`'s catalog — has none of; this schema is
 * what an entry's `points` array actually looks like before it is ever
 * imported into a row.
 *
 * **Drift risk and control.** This restates `apps/api`'s
 * `templatePointBodySchema` shape, in a different package, so the two can
 * drift. The control is Task 4's build-time spec: every catalog entry is
 * parsed through `createAssetTemplateBodySchema` (the API's own body
 * schema) in addition to this one, so a field this schema permits and the
 * API body rejects fails the build rather than shipping silently.
 */
export const stockTemplatePointDtoSchema = z.object({
  pointKey: z.string().min(1).max(128),
  label: z.string().max(255).nullable(),
  unit: z.string().max(32).nullable(),
  sourceDataKeyPattern: z.string().max(128).nullable(),
  formula: z.string().max(1000).nullable(),
  formulaDialect: calcDialectSchema.nullable(),
  kind: templatePointKindSchema,
  calcTrigger: z.enum(CALC_TRIGGERS).nullable(),
  calcIntervalSeconds: z.number().int().nullable(),
  maxInputAgeSeconds: z.number().int().nullable(),
  // ADR 0055 decision 11 (`F2.9` Task 8) — mirrors `adminTemplatePointDtoSchema`
  // above field for field, including the **no bound** reasoning: this is the
  // shape a catalog entry's own point-fields helper (`apps/api`'s
  // `derived()`) produces, and the `(0, 1]` bound lives only on the write
  // side, in `apps/api`'s `templatePointBodySchema`.
  minCoverageRatio: z.number().nullable(),
  required: z.boolean(),
  sortOrder: z.number().int(),
  // F2.13 / ADR 0052 decision 2 — every stock point declares its tier. The
  // WRITE shape here (matching `apps/api`'s `templatePointBodySchema.meta`
  // exactly: the whole object optional, `tier` required once present) rather
  // than `templatePointMetaDtoSchema`'s lenient read-side `.partial()` — a
  // catalog entry is authored fresh, never a stored row that might predate
  // this field.
  meta: z.object({ tier: z.enum(["core", "extended", "manual"]) }).strict().optional(),
  // `F2.7` / ADR 0056 decision 9 — a stock entry MAY declare the five metadata
  // defaults. **Optional** here, unlike the two row DTOs above, for the same
  // reason `meta` is: this is the write shape, and every catalog entry is
  // parsed through `apps/api`'s `.strict()` `templatePointBodySchema` (the
  // build-time spec and the runtime import both), so a required key would force
  // 615 literals to spell five nulls into a body that refuses them. `.partial()`
  // of the one shape, never five restated names — the vocabulary is declared
  // once in `point-metadata.ts`.
  ...pointMetadataFieldsSchema.partial().shape,
});

/**
 * One entry of the asset-template stock catalog as listed — ADR 0052.
 *
 * The catalog lives **outside the tenant tables** and is *imported* into a
 * real row the organization then owns. It carries no `organizationId` and
 * no `id`, because it is repository data rather than a row: the import
 * creates the row. Mirrors `dashboard-templates.ts`'s
 * `stockDashboardTemplateDtoSchema` exactly, one asset-template field
 * (`assetType`) standing in for that schema's `section`.
 *
 * Each entry carries its **own** `stockVersion`, not one catalog-wide
 * number, so improving one class's default does not renumber the others.
 *
 * **`content` is `z.record(z.unknown())`, matching
 * `adminAssetTemplateDtoSchema.content` for the identical reason.**
 * `templateContentSchema` — the tiered ADR 0019 contract for KPIs, alarms,
 * philosophy and point ordering — lives in
 * `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts`,
 * not in `@bms/shared` (ADR 0019 §8 ratifies that split: a Zod schema there
 * would be a runtime dependency, which AGENTS.md §9.4 gates). `@bms/shared`
 * cannot derive from a contract it is not permitted to depend on, so this
 * field stays a bare record here exactly as it does on the read-side DTO.
 * The `stockDashboardTemplateDtoSchema` sibling can carry
 * `sectionTemplateContentSchema` in full only because that one contract
 * happens to live in `@bms/shared` already.
 *
 * **No `.readonly()`**, matching `stockDashboardTemplateDtoSchema` exactly.
 * Immutability is taken at the catalog array in `apps/api`
 * (`STOCK_ASSET_TEMPLATE_CATALOG: readonly StockAssetTemplateEntry[]`),
 * where it is actually enforceable — a `.readonly()` here would describe a
 * DTO the wire has already copied, and say nothing true about the source
 * array. Say so here, or someone "fixes" it.
 */
export const stockAssetTemplateDtoSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  assetType: z.string().min(1).max(64),
  domain: z.string().min(1).max(64),
  description: z.string().nullable(),
  stockVersion: z.number().int().positive(),
  content: z.record(z.unknown()),
  points: z.array(stockTemplatePointDtoSchema),
});

/**
 * One asset built by `F2.2` instantiation (ADR 0015 §6).
 *
 * `skippedPoints` names the optional measured points that produced no
 * `asset_points` row because their `sourceDataKeyPattern` did not resolve.
 * Required points abort the batch instead, so anything listed here was
 * explicitly declared optional — surfaced because "12 points in, 10 rows out"
 * is otherwise indistinguishable from a bug.
 *
 * `seededRules` (ADR 0058 decision 10, `E2.4`) names the automation-rule
 * codes seeded from this asset's template alarms — `.length` is the count a
 * caller reads as "how many rules this asset got".
 */
export const instantiatedAssetDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  locationId: z.string(),
  rtuId: z.string().nullable(),
  pointCount: z.number(),
  skippedPoints: z.array(z.string()),
  seededRules: z.array(z.string()),
  /** `F3.2` / ADR 0067 decision 5 — one report per view of the asset
   * template's `content.dashboards` this asset received, empty when the
   * template carries none. */
  dashboards: z.array(instantiatedDashboardDtoSchema),
});

/** The result of one instantiate call — the whole batch or nothing. */
export const assetInstantiationResultDtoSchema = z.object({
  templateId: z.string(),
  templateCode: z.string(),
  templateVersion: z.number(),
  locationId: z.string(),
  rtuId: z.string().nullable(),
  /**
   * `measured` when instantiated through an RTU, `unmapped` through a
   * location. `.extract()` off `pointSourceKindSchema` (ADR 0018 §4.8) so this
   * narrow, two-value vocabulary derives from the wide one by construction
   * rather than by a second hand-maintained list that could drift from it.
   */
  sourceKind: pointSourceKindSchema.extract(["measured", "unmapped"]),
  assets: z.array(instantiatedAssetDtoSchema),
  assetCount: z.number(),
  pointCount: z.number(),
  /**
   * ADR 0058 decision 10 (`E2.4`) — how many `bms.automation_rules` rows this
   * call seeded, and how many of them seeded `enabled = false` (a philosophy
   * row with no operator/threshold, decision 3). A caller can tell from the
   * response how many commissioning limits are still owed.
   */
  ruleCount: z.number().int(),
  disabledRuleCount: z.number().int(),
  /** `F3.2` / ADR 0067 decision 5 — how many `bms.dashboards` rows this call
   * wrote across the whole batch. */
  dashboardCount: z.number().int(),
});

// Compile-time guard: the narrowing above must still describe exactly
// "measured" | "unmapped" — not silently widen if `.extract()`'s argument
// list is ever edited without checking what depends on the result.
type AssertAssignable<A extends B, B> = A;
export type AssetInstantiationSourceKindMatchesExpected = AssertAssignable<
  z.infer<typeof assetInstantiationResultDtoSchema>["sourceKind"],
  "measured" | "unmapped"
>;
export type ExpectedMatchesAssetInstantiationSourceKind = AssertAssignable<
  "measured" | "unmapped",
  z.infer<typeof assetInstantiationResultDtoSchema>["sourceKind"]
>;

// --- F2.6: template version lifecycle (ADR 0039) ----------------------------

/**
 * The five calc columns, as one shape used in three roles.
 *
 * ADR 0039 decision 6 makes resolution `coalesce(asset_points.<col>,
 * template_points.<col>)` per column, so "what the template says", "what this
 * asset overrides" and "what the engine will actually use" are the *same five
 * fields* read three ways. One schema, not three near-identical ones: a fourth
 * column added later must reach all three or the merge stops being total.
 *
 * Every field is nullable in every role. In the override role `null` means
 * "inherit"; in the template role it means the template never set one; in the
 * effective role it means neither did.
 *
 * No numeric bounds here, deliberately, matching
 * `adminTemplatePointDtoSchema`: this is a read-side DTO over stored rows, and
 * a read schema that rejects a row the database holds is a schema that lies
 * about the estate. The bounds are enforced on the write side, in `apps/api`,
 * from `MIN_CALC_INTERVAL_SECONDS` / `MAX_CALC_INTERVAL_SECONDS` /
 * `MAX_INPUT_AGE_SECONDS_BOUND`.
 */
export const assetPointCalcOverrideFieldsSchema = z.object({
  formula: z.string().nullable(),
  formulaDialect: calcDialectSchema.nullable(),
  calcTrigger: z.enum(CALC_TRIGGERS).nullable(),
  calcIntervalSeconds: z.number().nullable(),
  maxInputAgeSeconds: z.number().nullable(),
});

/**
 * One derived point of one asset, as the asset detail page shows it (ADR 0039
 * decision 8): what the pinned template version declares, what this asset
 * overrides, and what the engine resolves.
 *
 * `assetPointId` is `null` when no `asset_points` row exists yet — the normal
 * state for a derived point that has neither been overridden nor produced a
 * first value (ADR 0037), and the reason this DTO is keyed on `pointKey`
 * rather than on a row id that may not exist.
 */
export const assetPointCalcConfigDtoSchema = z.object({
  pointKey: z.string(),
  /** The `template_points` row this resolves against, on the version pinned now. */
  templatePointId: z.string(),
  label: z.string().nullable(),
  unit: z.string().nullable(),
  assetPointId: z.string().nullable(),
  template: assetPointCalcOverrideFieldsSchema,
  override: assetPointCalcOverrideFieldsSchema,
  effective: assetPointCalcOverrideFieldsSchema,
  /**
   * The template point's `min_coverage_ratio` (`F2.22` item 4 on the override
   * panel). **Template-only, and beside the three roles rather than a sixth
   * field inside them:** ADR 0055 decision 11 puts the ratio on the template
   * point and refuses a per-asset override, so it has no override role and no
   * merge. `null` is the stored value and means fail closed, not "no limit".
   * No bound here, by this DTO's own rule above — the `(0, 1]` bound is the
   * write side's, in `apps/api`.
   */
  minCoverageRatio: z.number().nullable(),
  /**
   * What the calc engine last did with this point (`F2.9`, ADR 0055 decision
   * 8 — plan design decision 9, layer 3), or `null` when the API process
   * serving this read has not evaluated it.
   *
   * **`null` does not mean "never ran".** The registry behind this field is
   * in-process and empty after a restart, and a multi-instance API answers
   * from whichever instance served the request. It is an operator hint — the
   * one place a cycle induced by a group membership becomes visible on the
   * asset an operator is actually looking at — and never an audit trail. The
   * authoritative records are `bms_api_calc_skipped_total` and the engine's
   * own transition log.
   *
   * `lastSkipReason` is deliberately `z.string()` and **not** an enum. The
   * reason vocabulary is `CalcRuntimeSkipReason`, which lives in `apps/api`
   * beside the code that raises each member and has grown with almost every
   * calc row (`F2.9` alone added six). Restating it here would put the same
   * list in two packages with no compiler edge between them — the drift
   * `F4.43` names — and the first symptom would be a Zod refusal of a response
   * the API is entitled to send, on a field nothing branches on. The web side
   * renders it as text.
   *
   * `at` is an ISO timestamp of the **evaluation**, not of the stored value,
   * whose time is bucketed to the formula's interval (ADR 0037 decision 8).
   */
  runtime: z
    .object({
      lastOutcome: z.enum(["written", "skipped"]),
      lastSkipReason: z.string().nullable(),
      at: z.string(),
    })
    .nullable(),
});
