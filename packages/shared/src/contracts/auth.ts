/**
 * Auth and access-scope contracts (ADR 0003 OIDC, ADR 0017 write matrix).
 *
 * `F4.23` / ADR 0030 decision 2 — these schemas ARE the contract; the types in
 * `index.ts` are `z.infer` of them.
 */
import { z } from "zod";

import { locationTypeCodeSchema } from "./location-types";

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
  /**
   * `F3.78` / ADR 0089 decision 4 — set by the OIDC guard, `true` only when the
   * token carries `email_verified: true` and a string `email`. The guard links a
   * `bms.users` row to the token's subject by email only when this is `true`.
   * Absent on a local-mode token.
   */
  emailVerified: z.boolean().optional(),
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
  type: locationTypeCodeSchema,
  province: z.string().nullable(),
});

export const accessAssetGroupSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  code: z.string(),
  name: z.string(),
  /**
   * ADR 0047 Amendment 6: the `asset_group_admin` authoring path derives the
   * create body's `organizationId` from the group the picker offers, so the
   * group's own organization travels with it here rather than being re-fetched.
   */
  organizationId: z.string(),
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

/**
 * `F4.203` — why an authenticated request was refused, when the reason is one
 * the user can act on. A closed set: a new code is a contract change.
 */
export const authFailureCodeSchema = z.enum(["account_deactivated"]);

/**
 * `F4.203` — the 401 body `JwtAuthGuard` sends. Nest's default envelope plus an
 * optional `code`: a deactivated account carries `account_deactivated`; an
 * expired, missing or unverifiable token carries none, and the web shows nothing
 * for it. Local login keeps its generic refusal (ADR 0089 decision 8) and never
 * sends a code.
 */
export const unauthorizedEnvelopeSchema = z.object({
  statusCode: z.literal(401),
  message: z.string(),
  error: z.string(),
  code: authFailureCodeSchema.optional(),
});
