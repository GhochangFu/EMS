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

export const templatePointBodySchema = z.object({
  pointKey: pointKeyCode,
  label: z.string().max(255).nullish(),
  unit: z.string().max(32).nullish(),
  kind: z.enum(["measured", "derived"]).default("measured"),
  sourceDataKeyPattern: z.string().max(128).nullish(),
  required: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

/**
 * A template's full point set. Sent whole on create and on every draft update —
 * the points ARE the template, and a partial patch would leave "did you mean to
 * delete the ones you omitted?" ambiguous on the one object where a silently
 * dropped point becomes a missing `asset_points` row on every future asset.
 *
 * Duplicate `pointKey`s are rejected here rather than by
 * `template_points_template_point_key_unique`, so the caller is told which code
 * collided instead of receiving a constraint name.
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
  });

export const createAssetTemplateBodySchema = z.object({
  organizationId: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  assetType: z.string().min(1).max(64),
  domain: z.string().min(1).max(64),
  description: z.string().max(2000).nullish(),
  content: templateContentSchema.optional(),
  points: templatePointsBodySchema.default([]),
});

/**
 * Draft edits only. `code` and `organizationId` are absent on purpose: they are
 * the identity a published version's pin resolves through, and `version` is
 * assigned by the version-bump rule, never by a caller.
 */
export const updateAssetTemplateBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  assetType: z.string().min(1).max(64).optional(),
  domain: z.string().min(1).max(64).optional(),
  description: z.string().max(2000).nullish(),
  content: templateContentSchema.optional(),
  points: templatePointsBodySchema.optional(),
});

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
const instantiateAssetBodySchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  siteName: z.string().min(1).max(255).optional(),
  sourceDataKeyVars: z.record(z.string().max(128)).optional(),
});

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
