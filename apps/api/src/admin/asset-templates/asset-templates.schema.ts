import {
  // F2.23 / ADR 0065 decision 1: the one catalog character class and its sentence.
  CATALOG_CODE_MESSAGE,
  CATALOG_CODE_PATTERN,
  createAssetTemplateBodySchema as sharedCreateAssetTemplateBodySchema,
  // ADR 0049 decision 2 — one declaration of the template lifecycle, read by
  // both template tables. Never a second z.enum here; §4.8 re-export rather
  // than restate, held by tests/f3.36-template-lifecycle-single-source.test.ts.
  templateLifecycleStatusSchema,
  templatePointBodySchema,
  updateAssetTemplateBodySchema as sharedUpdateAssetTemplateBodySchema,
} from "@bms/shared";
import { z } from "zod";

import { templateCycles } from "../../calc/calc-graph";

/**
 * Zod contracts for the asset-template admin surface (ADR 0015, backlog F2.1).
 *
 * **The structural bodies live in `packages/shared` since `F3.85` PR 11a**
 * (ADR 0099 decision 6, plan §11.3 Unit 1):
 * `packages/shared/src/contracts/asset-template-writes.ts` holds the point,
 * create and update bodies, and `asset-template-content-writes.ts` the tiered
 * `content` contract (`E1.7`, ADR 0019). The copilot catalog names the
 * update body by identity, and `packages/shared` must not import `apps/api`.
 * (ADR 0030 gave `@bms/shared` its `zod` runtime, which retired the reason
 * ADR 0015 §Resolved-decision-2's schema used to live here.)
 *
 * **One rule stays here: the template cycle check.** `templateCycles` is
 * `calc/calc-graph.ts`'s, shared with the scheduled sweep (ADR 0055
 * decision 8), so the bodies below are the shared ones plus an outer
 * `.superRefine` that reports each cycle member at `points.<index>.formula` —
 * the path and message it had when it ran inside the points array.
 */

export { templatePointBodySchema };

/**
 * `F2.9` Task 12 / ADR 0055 decision 8 — the `bms-calc-v2` half of the rule
 * the shared points refine enforces for `v1`. **Once, over the whole array**:
 * a cycle is a property of the set of points, invisible to any per-point rule,
 * and `templateCycles` already reports each member separately.
 *
 * The message names the members and says what was *found*. It deliberately
 * does not read as "this template has no cycles" (plan correction 52): a
 * template has no location, so `@domain`, `@group` and every `{CODE.key}`
 * resolve to nothing here and only `@site` — over the template's own
 * declared keys — resolves at all. The tick is the authority; this is the
 * subset a save can prove.
 *
 * At the body root rather than on the points array since `F3.85` PR 11a. The
 * one consequence: Zod skips an outer refine when a sibling field fails its
 * type check, so a body whose `name` is not a string no longer also reports
 * its cycles. Either way the answer is the same 400.
 */
function refineTemplateCycles(
  body: { readonly points?: readonly TemplatePointBody[] },
  ctx: z.RefinementCtx,
): void {
  const points = body.points;
  if (!points) {
    return;
  }
  const indexByPointKey = new Map(points.map((point, index) => [point.pointKey, index]));
  // `?? null`: the body's optional fields arrive as `undefined` when absent,
  // and the stored-row shape `templateCycles` takes spells the same absence
  // `null`. It skips a point with no formula either way — this only makes the
  // two spellings one.
  const cycleInput = points.map((point) => ({
    pointKey: point.pointKey,
    kind: point.kind,
    formula: point.formula ?? null,
    formulaDialect: point.formulaDialect ?? null,
  }));
  for (const cycle of templateCycles(cycleInput)) {
    const index = indexByPointKey.get(cycle.pointKey);
    if (index === undefined) continue;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["points", index, "formula"],
      message:
        `This point's formula lies on a dependency cycle. The points on it are: ` +
        `${cycle.members.join(", ")}. None of them can ever compute — each waits on ` +
        "another, so all of them stay unwritten. Only this template's own points are in " +
        "view when it saves: @site resolves to the keys declared here, and @domain, @group " +
        "and {CODE.key} resolve to nothing until assets exist. This check therefore reports " +
        "the cycle it found and cannot rule out one that appears once the template is " +
        "instantiated beside other assets.",
    });
  }
}

const TEMPLATE_CYCLES_DESCRIPTION =
  "No derived point's formula may lie on a dependency cycle among this template's own " +
  "points (ADR 0055 decision 8). Only @site resolves at save time, over the keys declared " +
  "here; @domain, @group and {CODE.key} resolve once the template is instantiated.";

/** The shared create body plus the cycle check. */
export const createAssetTemplateBodySchema = sharedCreateAssetTemplateBodySchema
  .superRefine(refineTemplateCycles)
  .describe(TEMPLATE_CYCLES_DESCRIPTION);

/**
 * Draft edits only. `code` and `organizationId` are absent on purpose: they are
 * the identity a published version's pin resolves through, and `version` is
 * assigned by the version-bump rule, never by a caller.
 *
 * The shared update body plus the cycle check. `_def.schema` is the
 * `@bms/shared` export itself — `asset-templates.schema-move.spec.ts` holds
 * that identity, which the copilot catalog relies on.
 */
export const updateAssetTemplateBodySchema = sharedUpdateAssetTemplateBodySchema
  .superRefine(refineTemplateCycles)
  .describe(TEMPLATE_CYCLES_DESCRIPTION);

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
    // F2.23 / ADR 0065 decision 1: the catalog class, beside the length bound.
    // Zod runs every check and reports every issue, so `.max()` does not gate
    // the regex; the class is one anchored character class and linear anyway.
    code: z.string().min(1).max(64).regex(CATALOG_CODE_PATTERN, CATALOG_CODE_MESSAGE),
    name: z.string().min(1).max(255),
    siteName: z.string().min(1).max(255).optional(),
    sourceDataKeyVars: z.record(z.string().max(128)).optional(),
  })
  .strict();

/**
 * The number of assets one instantiation may create (ADR 0015). Exported for
 * `F3.22` (ADR 0091 decision 4), which applies the same bound to the sum of
 * templated assets over one onboarding commit.
 */
export const MAX_INSTANTIATE_ASSETS = 200;

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
    assets: z.array(instantiateAssetBodySchema).min(1).max(MAX_INSTANTIATE_ASSETS),
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

/**
 * Ceiling on rule ids per re-apply call.
 *
 * Wider than the 200-asset batch ceilings above because the unit here is a
 * rule, and one instantiate of 200 assets carrying 200 alarms seeds up to
 * `MAX_RULE_ROWS` (2,500) of them. 500 is one `inArray` well under the bind
 * ceiling and enough to re-apply one alarm across a whole press in one call.
 */
const MAX_REAPPLY_RULES = 500;

/**
 * `E2.4` / ADR 0058 decision 8 — the body of
 * `POST /admin/asset-templates/:id/seeded-rules/reapply`.
 *
 * The ids are named explicitly and nothing else is accepted: decision 8's
 * whole answer to the local-override question is that a tuned threshold is
 * only ever overwritten by someone choosing that rule, having seen both
 * values. A `{ all: true }` here would be the republish-moves-live-rules
 * outcome decision 1 refuses, one field away.
 *
 * Duplicates are refused rather than deduplicated: the same id twice is a
 * client that built its list wrongly, and a silent `Set` would answer 200 to
 * a request that does not say what the client meant.
 */
export const reapplySeededRulesBodySchema = z
  .object({
    ruleIds: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_REAPPLY_RULES)
      .describe(
        `The seeded rules to move to the currently published version's alarm values. Between ` +
          `1 and ${MAX_REAPPLY_RULES}, each seeded from this template and on an asset inside your ` +
          "writable locations.",
      ),
  })
  // `.strict()` must precede `.superRefine` — it returns a `ZodEffects`,
  // which has no `.strict()`. Nothing may separate `.superRefine(...)` from
  // its `.describe(...)` (tests/adr-0029-openapi-contract.test.ts).
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.ruleIds.forEach((id, index) => {
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ruleIds", index],
          message: `Duplicate rule id "${id}" in this batch; name each rule once`,
        });
      }
      seen.add(id);
    });
  })
  .describe(
    "Names the seeded rules to re-apply, explicitly and once each — a rule an engineer tuned " +
      "is only ever overwritten by someone choosing it here (ADR 0058 decision 8).",
  );

export type CreateAssetTemplateBody = z.infer<typeof createAssetTemplateBodySchema>;
export type UpdateAssetTemplateBody = z.infer<typeof updateAssetTemplateBodySchema>;
export type TemplatePointBody = z.infer<typeof templatePointBodySchema>;
export type InstantiateAssetsBody = z.infer<typeof instantiateAssetsBodySchema>;
export type InstantiateAssetBody = z.infer<typeof instantiateAssetBodySchema>;
export type InstantiationTargetInput = InstantiateAssetsBody["target"];
export type ReapplySeededRulesBody = z.infer<typeof reapplySeededRulesBodySchema>;

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
