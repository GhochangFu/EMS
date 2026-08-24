/**
 * `F4.16` / ADR 0043 Amendment 1 — three roles, three pools.
 *
 * There is no default token. `locations`, `user_organization_access`,
 * `point_keys`, `asset_templates` and `onboarding_sessions` carry Row Level
 * Security (migration `0040`); every call site that touches one of those
 * tables must pick `AUTH_DRIZZLE`, `TENANT_DRIZZLE` (inside `withTenant`), or
 * `FLEET_DRIZZLE` deliberately. A silent default previously aliased to the
 * tenant pool, which let every caller keep compiling while running with no
 * `SET LOCAL app.current_organization` ever issued — RLS then filtered every
 * row out. See Task 6.6 in `docs/superpowers/plans/2026-08-24-f4.16-tenant-role-split.md`.
 */
export const AUTH_POOL = Symbol("PG_POOL_AUTH");
export const TENANT_POOL = Symbol("PG_POOL_TENANT");
export const FLEET_POOL = Symbol("PG_POOL_FLEET");

export const AUTH_DRIZZLE = Symbol("DRIZZLE_AUTH");
export const TENANT_DRIZZLE = Symbol("DRIZZLE_TENANT");
export const FLEET_DRIZZLE = Symbol("DRIZZLE_FLEET");
