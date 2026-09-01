import {
  assetDomainCodeSchema,
  CALC_DIALECT,
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
    formulaDialect: z.literal(CALC_DIALECT).nullish(),
    // ADR 0037 decision 4: when the formula above runs, and how stale its
    // inputs may be. Cross-checked against `kind`/`calcTrigger` below —
    // a per-point refinement, unlike decision 7's cross-point rule, since
    // every fact this needs lives on the point itself.
    calcTrigger: z.enum(CALC_TRIGGERS).nullish(),
    calcIntervalSeconds: z.number().int().min(MIN_CALC_INTERVAL_SECONDS).max(MAX_CALC_INTERVAL_SECONDS).nullish(),
    maxInputAgeSeconds: z.number().int().min(1).max(MAX_INPUT_AGE_SECONDS_BOUND).nullish(),
    required: z.boolean().default(true),
    sortOrder: z.number().int().min(0).default(0),
  })
  // `.strict()` must sit on the object, before `.superRefine` — a
  // `ZodEffects` (what `.superRefine`/`.refine`/`.transform` return) has no
  // `.strict()`. Nothing may separate `.superRefine(...)` from the
  // `.describe(...)` below it (tests/adr-0029-openapi-contract.test.ts).
  .strict()
  .superRefine((point, ctx) => {
    const hasFormula = point.formula != null || point.formulaDialect != null;
    if (point.kind === "derived" && (!point.formula || point.formulaDialect !== CALC_DIALECT)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formula"],
        message: `A derived point requires "formula" and formulaDialect: "${CALC_DIALECT}"`,
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
  })
  .describe(
    'A derived point requires "formula", formulaDialect: "bms-calc-v1", and a calcTrigger ' +
      'of "streaming" or "scheduled" ("scheduled" also requires calcIntervalSeconds); a ' +
      "measured point must carry none of those five fields.",
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
      const result = validateFormula(point.formula, declaredKeys);
      if (!result.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "formula"],
          message: `Invalid formula: ${formatCalcError(result.errors[0])}`,
        });
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
      "`formula` must parse under bms-calc-v1, every `{ref}` must resolve to a point declared " +
      "in this array, and none of those references may resolve to another derived point.",
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
