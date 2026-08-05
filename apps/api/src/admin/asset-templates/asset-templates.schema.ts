import { z } from "zod";

/**
 * Zod contracts for the asset-template admin surface (ADR 0015, backlog F2.1).
 *
 * ADR 0015 §Resolved-decision-2 places the `content` contract in
 * `packages/shared`. It lives here instead: `@bms/shared` is a types-only
 * package with `typescript` as its sole devDependency, so moving a Zod schema
 * there would add a *runtime* dependency to it — which is exactly the manifest
 * change AGENTS.md §9.4 gates. The DTO types are in `@bms/shared`; the
 * validator that produces them is here, where zod already lives. `E1.7` tightens
 * `templateContentSchema` in place.
 */

/** Reserved E1.7 overlay surface: KPIs, alarm philosophies, dashboards, hooks. */
export const templateContentSchema = z.record(z.unknown());

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

export type CreateAssetTemplateBody = z.infer<typeof createAssetTemplateBodySchema>;
export type UpdateAssetTemplateBody = z.infer<typeof updateAssetTemplateBodySchema>;
export type TemplatePointBody = z.infer<typeof templatePointBodySchema>;
