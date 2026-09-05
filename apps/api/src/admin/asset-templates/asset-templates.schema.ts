import {
  assetDomainCodeSchema,
  CALC_DIALECT,
  CALC_DIALECT_V2,
  CALC_DIALECTS,
  calcDialectSchema,
  CALC_TRIGGERS,
  formatCalcError,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
  // ADR 0049 decision 2 — one declaration of the template lifecycle, read by
  // both template tables. Never a second z.enum here; §4.8 re-export rather
  // than restate, held by tests/f3.36-template-lifecycle-single-source.test.ts.
  templateLifecycleStatusSchema,
  validateFormula,
} from "@bms/shared";
import { z } from "zod";

import { templateContentSchema } from "./asset-templates-content.schema";

/**
 * Zod contracts for the asset-template admin surface (ADR 0015, backlog F2.1).
 *
 * ADR 0015 §Resolved-decision-2 places the `content` contract in
 * `packages/shared`. It lives here instead: `@bms/shared` is a types-only
 * package with `typescript` as its sole devDependency, so moving a Zod schema
 * there would add a *runtime* dependency to it — which is exactly the manifest
 * change AGENTS.md §9.4 gates. The DTO types are in `@bms/shared`; the
 * validator that produces them is here, where zod already lives. ADR 0019 §8
 * ratifies that deviation.
 *
 * `E1.7` tightened `templateContentSchema` from `z.record(z.unknown())` into the
 * tiered contract in `./asset-templates-content.schema`, which is a file of its
 * own only because this one would otherwise carry two unrelated contracts.
 */

const pointKeyCode = z.string().min(1).max(128);

export const templatePointBodySchema = z
  .object({
    pointKey: pointKeyCode,
    label: z.string().max(255).nullish(),
    unit: z.string().max(32).nullish(),
    kind: z.enum(["measured", "derived"]).default("measured"),
    sourceDataKeyPattern: z.string().max(128).nullish(),
    // ADR 0036 decision 5. Cross-point rules (a derived formula's references
    // must resolve to measured siblings, decision 7) cannot live here — a
    // per-point refinement cannot see the rest of the array — and are enforced
    // by templatePointsBodySchema's own superRefine below instead.
    formula: z.string().min(1).max(1000).nullish(),
    // ADR 0055 decision 2 (`F2.9`): the vocabulary is `CALC_DIALECTS`, derived
    // once as `calcDialectSchema`. Never a literal here — a literal pins this
    // one endpoint to `bms-calc-v1` while every other endpoint accepts `v2`,
    // so the same stored row reads back on one page and 400s on another
    // (`tests/adr-0055-calc-v2-invariants.test.ts` part (c)).
    formulaDialect: calcDialectSchema.nullish(),
    // ADR 0037 decision 4: when the formula above runs, and how stale its
    // inputs may be. Cross-checked against `kind`/`calcTrigger` below —
    // a per-point refinement, unlike decision 7's cross-point rule, since
    // every fact this needs lives on the point itself.
    calcTrigger: z.enum(CALC_TRIGGERS).nullish(),
    calcIntervalSeconds: z.number().int().min(MIN_CALC_INTERVAL_SECONDS).max(MAX_CALC_INTERVAL_SECONDS).nullish(),
    maxInputAgeSeconds: z.number().int().min(1).max(MAX_INPUT_AGE_SECONDS_BOUND).nullish(),
    // ADR 0055 decision 11 (`F2.9`): the fraction of an aggregate's *declared*
    // members that must carry a fresh value before the result is written.
    //
    // **The `(0, 1]` bound lives here, on the write side, and nowhere else.**
    // `0` would admit an aggregate computed over nothing, and anything above
    // `1` can never be satisfied — both are author mistakes, and both are
    // silent at evaluation time. `adminTemplatePointDtoSchema` deliberately
    // carries no bound: a read reports what the row holds, and migration
    // `0062` puts no `CHECK` on the column (the `0035`/`0036` precedent).
    //
    // Absent or `null` means **fail closed** — every declared member must be
    // fresh — not "no limit". Refused below on anything but a `v2` derived
    // point, where it is the only shape that has an aggregate to cover.
    minCoverageRatio: z.number().gt(0).max(1).nullish(),
    required: z.boolean().default(true),
    sortOrder: z.number().int().min(0).default(0),
    // F2.13 / ADR 0052 decision 2, ADR 0040 open question 4 — the tier
    // marking that makes a client's redline mechanical (C -> core, X ->
    // extended). `bms.template_points.meta jsonb` has carried this since
    // `0024`; nothing could write it until now. A CLOSED shape, not
    // `z.record(z.unknown())` — `meta` is provenance with exactly one known
    // key today, and a free-form jsonb bag on an authoring surface is the
    // drift ADR 0019 §3 refuses.
    meta: z.object({ tier: z.enum(["core", "extended", "manual"]) }).strict().optional(),
  })
  // `.strict()` must sit on the object, before `.superRefine` — a
  // `ZodEffects` (what `.superRefine`/`.refine`/`.transform` return) has no
  // `.strict()`. Nothing may separate `.superRefine(...)` from the
  // `.describe(...)` below it (tests/adr-0029-openapi-contract.test.ts).
  .strict()
  .superRefine((point, ctx) => {
    const hasFormula = point.formula != null || point.formulaDialect != null;
    // The dialect itself is checked by `calcDialectSchema` above, so all this
    // has to see is that both fields are present. The message names every
    // dialect rather than one, because since ADR 0055 there are two.
    if (point.kind === "derived" && (!point.formula || point.formulaDialect == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formula"],
        message:
          'A derived point requires "formula" and a formulaDialect of ' +
          CALC_DIALECTS.map((dialect) => `"${dialect}"`).join(" or "),
      });
    }
    if (point.kind === "measured" && hasFormula) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formula"],
        message: 'A measured point must not carry a formula — only "derived" points may',
      });
    }

    const hasCalcConfig =
      point.calcTrigger != null || point.calcIntervalSeconds != null || point.maxInputAgeSeconds != null;
    if (point.kind === "measured" && hasCalcConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["calcTrigger"],
        message: "A measured point must not carry calcTrigger, calcIntervalSeconds, or maxInputAgeSeconds",
      });
    }
    if (point.kind === "derived") {
      // ADR 0055 decision 10, mirrored at the write boundary. A `bms-calc-v2`
      // formula resolves its cross-asset membership once per sweep, so there
      // is nothing for it to resolve against on a single incoming reading —
      // a streaming `v2` point would store clean and never compute.
      //
      // Combined with the `scheduled -> interval required` branch below, this
      // is the whole of decision 10 here: a `v2` point IS scheduled, therefore
      // it MUST carry an interval, so a null interval becomes a save-time
      // rejection instead of a formula that silently never runs.
      if (point.formulaDialect === CALC_DIALECT_V2 && point.calcTrigger !== "scheduled") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calcTrigger"],
          message:
            `A "${CALC_DIALECT_V2}" point requires calcTrigger: "scheduled" — a cross-asset ` +
            "formula resolves its members once per sweep and cannot run on a single reading",
        });
      }
      if (point.calcTrigger == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calcTrigger"],
          message: 'A derived point requires calcTrigger: "streaming" or "scheduled"',
        });
      } else if (point.calcTrigger === "scheduled" && point.calcIntervalSeconds == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calcIntervalSeconds"],
          message: "A scheduled point requires calcIntervalSeconds",
        });
      } else if (point.calcTrigger === "streaming" && point.calcIntervalSeconds != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calcIntervalSeconds"],
          message: "A streaming point must not carry calcIntervalSeconds — it runs on every matching reading",
        });
      }
    }

    // ADR 0055 decision 11. The ratio is the coverage of an *aggregate's*
    // member set, and only a `v2` derived formula can hold an aggregate — on
    // anything else it is a value that reads as configured and is never
    // consulted, which is the silent shape this repository refuses.
    if (
      point.minCoverageRatio != null &&
      !(point.kind === "derived" && point.formulaDialect === CALC_DIALECT_V2)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minCoverageRatio"],
        message:
          `minCoverageRatio applies only to a derived point in the "${CALC_DIALECT_V2}" ` +
          "dialect — it is the fraction of an aggregate's declared members that must be fresh",
      });
    }
  })
  .describe(
    'A derived point requires "formula", a formulaDialect of "bms-calc-v1" or ' +
      '"bms-calc-v2", and a calcTrigger of "streaming" or "scheduled" ("scheduled" also ' +
      'requires calcIntervalSeconds). A "bms-calc-v2" point must be "scheduled", and is ' +
      "the only shape that may carry minCoverageRatio, which is bounded to (0, 1] and " +
      "means fail-closed when absent. A measured point must carry none of those fields.",
  );

/**
 * A template's full point set. Sent whole on create and on every draft update —
 * the points ARE the template, and a partial patch would leave "did you mean to
 * delete the ones you omitted?" ambiguous on the one object where a silently
 * dropped point becomes a missing `asset_points` row on every future asset.
 *
 * Duplicate `pointKey`s are rejected here rather than by
 * `template_points_template_point_key_unique`, so the caller is told which code
 * collided instead of receiving a constraint name.
 *
 * ADR 0036 decision 7's sibling rule lives here too, not on
 * `templatePointBodySchema`: a per-point refinement cannot see the rest of the
 * array, and "does this formula's `{ref}` resolve to a measured point" needs
 * every other point's `kind`.
 */
const templatePointsBodySchema = z
  .array(templatePointBodySchema)
  .max(500)
  .superRefine((points, ctx) => {
    const seen = new Set<string>();
    points.forEach((point, index) => {
      if (seen.has(point.pointKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "pointKey"],
          message: `Duplicate point key "${point.pointKey}" in this template`,
        });
      }
      seen.add(point.pointKey);
    });

    const kindByKey = new Map(points.map((point) => [point.pointKey, point.kind]));
    const declaredKeys = points.map((point) => point.pointKey);

    points.forEach((point, index) => {
      if (point.kind !== "derived" || !point.formula) {
        // no formula, or already flagged by templatePointBodySchema's own
        // per-point refinement — nothing this sibling-scoped check can add
        return;
      }
      // A point that reached here has a dialect (the per-point refinement
      // refuses a derived point without one); the fallback keeps this total
      // rather than parsing `v2` syntax under `v1` rules by accident.
      const dialect = point.formulaDialect ?? CALC_DIALECT;
      const result = validateFormula(point.formula, declaredKeys, { dialect });
      if (!result.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "formula"],
          message: `Invalid formula: ${formatCalcError(result.errors[0])}`,
        });
        return;
      }
      if (dialect !== CALC_DIALECT) {
        // ADR 0055 decision 7 repeals the refusal below for `bms-calc-v2`: a
        // `v2` formula may reference a derived point, and the cycle — not the
        // reference — is what has to be refused. That check needs the real
        // dependency graph and lands with `F2.9` Task 12, which calls
        // `templateCycles(points)` here. Until then this branch is a no-op on
        // purpose: a stub cycle check would be a guard that gates nothing,
        // and a `v2` row is a counted skip in the engine until PR 2 anyway.
        return;
      }
      const derivedRef = result.refs.find((ref) => kindByKey.get(ref) === "derived");
      if (derivedRef) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "formula"],
          message:
            derivedRef === point.pointKey
              ? "This point's formula references itself — a derived formula may only " +
                "reference measured points"
              : "This point's formula references another derived point — a derived formula " +
                "may only reference measured points",
        });
      }
    });
  })
  .describe(
    "Every `pointKey` must be unique within this template's points. A derived point's " +
      "`formula` must parse under the dialect it declares, and every local `{ref}` must " +
      "resolve to a point declared in this array. Under bms-calc-v1, none of those " +
      "references may resolve to another derived point; bms-calc-v2 lifts that restriction " +
      "(ADR 0055 decision 7) and its cross-asset references resolve at evaluation time.",
  );

export const createAssetTemplateBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(255),
    assetType: z.string().min(1).max(64),
    // ADR 0031 Amendment 1: shape only; `AssetTemplatesService` checks the code
    // against `bms.asset_domains`. Instantiating a template copies this value
    // straight onto every asset it creates
    // (`asset-templates-instantiate.service.ts`), so an unchecked template domain
    // becomes a foreign-key violation one hop later, at instantiation time, far
    // from the form that caused it.
    domain: assetDomainCodeSchema,
    description: z.string().max(2000).nullish(),
    content: templateContentSchema.optional(),
    points: templatePointsBodySchema.default([]),
  })
  .strict();

/**
 * Draft edits only. `code` and `organizationId` are absent on purpose: they are
 * the identity a published version's pin resolves through, and `version` is
 * assigned by the version-bump rule, never by a caller.
 */
export const updateAssetTemplateBodySchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    assetType: z.string().min(1).max(64).optional(),
    domain: assetDomainCodeSchema.optional(),
    description: z.string().max(2000).nullish(),
    content: templateContentSchema.optional(),
    points: templatePointsBodySchema.optional(),
  })
  .strict();

/**
 * One asset to build from the template (`F2.2`, ADR 0015 §6).
 *
 * `siteName` is optional and falls back to the target location's name. The
 * column is `NOT NULL`, but making the caller repeat one string forty times is
 * a transcription error waiting to happen (Amendment 1C).
 *
 * `sourceDataKeyVars` fills the `{token}`s in each point's
 * `sourceDataKeyPattern` — `CH{unit}_CHW_SUPPLY_T` + `{ unit: "01" }` →
 * `CH01_CHW_SUPPLY_T`. `{asset_code}` is always available and is *not* taken
 * from here; see `INSTANTIATE_RESERVED_VAR` in the service.
 */
const instantiateAssetBodySchema = z
  .object({
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(255),
    siteName: z.string().min(1).max(255).optional(),
    sourceDataKeyVars: z.record(z.string().max(128)).optional(),
  })
  .strict();

/**
 * The instantiation payload (ADR 0015 §6, as amended 2026-08-05).
 *
 * The target is `rtuId` **or** `locationId`, never both and never neither.
 * ADR 0018 made `assets.rtu_id` nullable and `location_id` `NOT NULL`, so an
 * RTU-only payload — what §6 originally specified — could not express a
 * gateway-less asset at all. Both supplied is rejected rather than resolved by
 * precedence: the two disagree the moment an RTU moves between locations, and
 * silently preferring one would put assets somewhere the caller did not ask for.
 *
 * Duplicate codes within the batch are caught here, not by
 * `assets_code_unique`. `bms.assets.code` is *globally* unique, so a batch
 * carrying the same code twice fails on the second insert and rolls back all
 * forty — with a constraint name instead of the code that collided.
 */
export const instantiateAssetsBodySchema = z
  .object({
    rtuId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
    assets: z.array(instantiateAssetBodySchema).min(1).max(200),
  })
  // `.strict()` must precede `.superRefine` — it returns a `ZodEffects`,
  // which has no `.strict()`. Nothing may separate `.superRefine(...)` from
  // its `.describe(...)`; `.transform(...)` chains after the describe.
  .strict()
  .superRefine((body, ctx) => {
    if (Boolean(body.rtuId) === Boolean(body.locationId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rtuId"],
        message: body.rtuId
          ? "Supply rtuId or locationId, not both — an RTU already determines its location"
          : "Supply exactly one of rtuId (wired assets) or locationId (gateway-less assets)",
      });
    }

    const seen = new Set<string>();
    body.assets.forEach((asset, index) => {
      if (seen.has(asset.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "code"],
          message: `Duplicate asset code "${asset.code}" in this batch; asset codes are globally unique`,
        });
      }
      seen.add(asset.code);
    });
  })
  .describe(
    "Supply exactly one of `rtuId` (wired assets) or `locationId` " +
      "(gateway-less assets) — never both, because an RTU already determines " +
      "its location. Every `code` in `assets` must be unique within the batch; " +
      "asset codes are globally unique.",
  )
  /**
   * Narrows the exclusive pair into a discriminated target.
   *
   * Without this the inferred type is `{ rtuId?: string; locationId?: string }`
   * — the exclusivity lives only in the refinement above, so the service would
   * need a `body.locationId as string` assertion to query with. That assertion
   * would keep compiling if the refinement were ever loosened, and silently
   * produce `eq(locations.id, undefined)`. Transforming here means the service
   * receives a shape where the wrong access does not typecheck.
   *
   * Refinements run before transforms, so by this point exactly one is set;
   * the throw states that invariant rather than trusting it silently.
   */
  .transform((body) => {
    const target = body.rtuId
      ? ({ kind: "rtu", rtuId: body.rtuId } as const)
      : body.locationId
        ? ({ kind: "location", locationId: body.locationId } as const)
        : null;
    if (!target) {
      throw new Error("unreachable: the exclusive-target refinement guarantees one is set");
    }
    return { target, assets: body.assets };
  });

export type CreateAssetTemplateBody = z.infer<typeof createAssetTemplateBodySchema>;
export type UpdateAssetTemplateBody = z.infer<typeof updateAssetTemplateBodySchema>;
export type TemplatePointBody = z.infer<typeof templatePointBodySchema>;
export type InstantiateAssetsBody = z.infer<typeof instantiateAssetsBodySchema>;
export type InstantiateAssetBody = z.infer<typeof instantiateAssetBodySchema>;
export type InstantiationTargetInput = InstantiateAssetsBody["target"];

/**
 * The `status` filter on `GET /admin/asset-templates`.
 *
 * Moved here from the controller by `F4.20`: declared there, it was invisible
 * to ADR 0029's registry, which can only see schemas exported from a
 * `*.schema.ts` — so that route's only parameter would have gone undocumented
 * for a reason no reader could have guessed.
 *
 * It was **not** the only schema declared inside a controller, which a first
 * version of this note claimed. Three controllers also hold a local
 * `idParamSchema`. Those stay: a path parameter is described by Nest's own
 * reflection rather than by the registry, so moving them would change nothing
 * about the document. Their real problem is that they duplicate
 * `admin.schema.ts`'s `idParamSchema`, which is a different item's to fix.
 */
export const templateStatusQuerySchema = templateLifecycleStatusSchema;
