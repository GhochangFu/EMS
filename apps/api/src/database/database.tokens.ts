/**
 * `F4.16` / ADR 0043 Amendment 1 — three roles, three pools.
 *
 * `DRIZZLE` and `POOL_TOKEN` are kept and now resolve to the **tenant** pool, so
 * every existing injection site keeps working unchanged. New code that needs the
 * fleet or the auth connection asks for it by name.
 */
export const AUTH_POOL = Symbol("PG_POOL_AUTH");
export const TENANT_POOL = Symbol("PG_POOL_TENANT");
export const FLEET_POOL = Symbol("PG_POOL_FLEET");

export const AUTH_DRIZZLE = Symbol("DRIZZLE_AUTH");
export const TENANT_DRIZZLE = Symbol("DRIZZLE_TENANT");
export const FLEET_DRIZZLE = Symbol("DRIZZLE_FLEET");

/** @deprecated Prefer the explicit tokens. Retained so F4.16 changes no call site. */
export const DRIZZLE = TENANT_DRIZZLE;
/** @deprecated Prefer the explicit tokens. Retained so F4.16 changes no call site. */
export const POOL_TOKEN = TENANT_POOL;
