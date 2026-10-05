/**
 * `F3.78` / ADR 0089 decision 12 — the user grants API
 * (`/api/v1/admin/users/:id/grants`) request and response contracts.
 *
 * All plain `z.object`s: nothing here is an intersection or an all-readonly
 * object, so there is no `.merge()`, no `z.intersection` and no `.readonly()`
 * (ADR 0030).
 */
import { z } from "zod";

/** The three grant tables: `user_organization_access`, `user_location_access`, `user_asset_group_access`. */
export const userGrantKindSchema = z.enum(["organization", "location", "asset_group"]);

/** One grant row as the admin screen reads it. */
export const userGrantDtoSchema = z.object({
  /** The grant row's own id — the `:grantId` of `DELETE /admin/users/:id/grants/:kind/:grantId`. */
  id: z.string().uuid(),
  kind: userGrantKindSchema,
  /** The organization, location or asset group the grant names. */
  targetId: z.string().uuid(),
  targetName: z.string(),
  /**
   * `F4.201`: asset_group grants only — the group's location; absent on
   * organization and location grants. Two locations can each have an "HVAC"
   * group, and the name alone does not tell them apart.
   */
  locationName: z.string().optional(),
  /** The grant target's organization (the organization itself for an organization grant). */
  organizationId: z.string().uuid(),
  /**
   * Plan D2: whether the user's role reads this grant **now** — the grant's
   * kind equals the read-scope source the role's ordered list selects. A
   * viewer with an organization grant and a location grant reads only the
   * organization one; the screen says "not used by the `<role>` role".
   */
  effective: z.boolean(),
  createdAt: z.string(),
});

export const userGrantsResponseSchema = z.object({
  items: z.array(userGrantDtoSchema),
});

/** `POST /admin/users/:id/grants`. */
export const addUserGrantBodySchema = z
  .object({
    kind: userGrantKindSchema,
    targetId: z.string().uuid(),
  })
  .strict();
