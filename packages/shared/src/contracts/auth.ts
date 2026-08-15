/**
 * Auth and access-scope contracts (ADR 0003 OIDC, ADR 0017 write matrix).
 *
 * `F4.23` / ADR 0030 decision 2 — these schemas ARE the contract; the types in
 * `index.ts` are `z.infer` of them.
 */
import { z } from "zod";

/** Prototype role slugs stored in `bms.users.role`. */
export const userRoleSchema = z.enum([
  "admin",
  "organization_admin",
  "location_admin",
  "asset_group_admin",
  "operator",
  "viewer",
]);

/** JWT payload claims issued by `apps/api` (prototype). */
export const jwtPayloadSchema = z.object({
  sub: z.string(),
  email: z.string(),
  name: z.string(),
  role: userRoleSchema,
});

/**
 * The user block of a login response.
 *
 * Named separately because `CurrentUserResponse` referenced it as
 * `LoginResponse["user"]` — an indexed access into another type. A schema has
 * no indexed access, so the shared shape becomes a shared schema, which is the
 * same relationship expressed one level earlier.
 */
export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
});

/** Successful login response body from `POST /api/v1/auth/login`. */
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal("Bearer"),
  expiresIn: z.string(),
  user: sessionUserSchema,
});

export const accessScopeKindSchema = z.enum(["global", "location", "asset_group", "none"]);

export const accessLocationSchema = z.object({
  id: z.string(),
  code: z.string(),
  slug: z.string(),
  name: z.string(),
  type: z.enum(["smoc_campus", "rsmoc", "csmoc"]),
  province: z.string().nullable(),
});

export const accessAssetGroupSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  code: z.string(),
  name: z.string(),
});

export const accessibleScopeSchema = z.object({
  kind: accessScopeKindSchema,
  locations: z.array(accessLocationSchema),
  assetGroups: z.array(accessAssetGroupSchema),
  assetIds: z.array(z.string()),
});

export const currentUserResponseSchema = z.object({
  user: sessionUserSchema,
  scope: accessibleScopeSchema,
});
