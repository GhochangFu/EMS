import { z } from "zod";

import { CATALOG_CODE_MESSAGE, CATALOG_CODE_PATTERN } from "../constants";

/**
 * The asset-template instantiation body (`F2.2`, ADR 0015 §6), moved here from
 * `apps/api/src/admin/asset-templates/asset-templates.schema.ts` by `F4.254`
 * PR 1 so the copilot catalog can name it by identity (ADR 0099 decision 6):
 * `packages/shared` must not import `apps/api`. The api schema file re-exports
 * every name below, so its importers change nothing.
 */

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
export const instantiateAssetBodySchema = z
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

export type InstantiateAssetsBody = z.infer<typeof instantiateAssetsBodySchema>;
export type InstantiateAssetBody = z.infer<typeof instantiateAssetBodySchema>;
export type InstantiationTargetInput = InstantiateAssetsBody["target"];
