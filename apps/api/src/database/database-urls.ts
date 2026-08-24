/**
 * `F4.16` / ADR 0043 decision 8 + Amendment 1 — `DATABASE_URL` splits three
 * ways, and there is deliberately **no fallback**.
 *
 * `DATABASE_URL` names the schema owner — `bms_owner` since ADR 0045, `bms_app`
 * before it — and an owner is unfiltered on every table that is not `FORCE`.
 * ADR 0045 narrowed that but did not close it: `0041` puts `FORCE` on the five
 * `0040` tables only, so on the rest the owner still reads across tenants.
 * Silently falling back to it would leave the API running with RLS effectively
 * off while every test still passed — exactly the "theatre" decision 8 exists to
 * prevent. So a missing variable is a startup failure that names all of them at
 * once.
 */
export interface DatabaseUrls {
  readonly auth: string;
  readonly tenant: string;
  readonly fleet: string;
}

/**
 * Exported so a second reader of `DATABASE_URL_AUTH` — `telemetry-notify.
 * service.ts` builds its own long-lived `pg.Client` rather than going through
 * `AUTH_POOL`, so it cannot take the pool by injection — names the same
 * constant instead of a second string literal that could drift from this one.
 */
export const DATABASE_URL_AUTH_ENV_VAR = "DATABASE_URL_AUTH";

const REQUIRED = [
  ["auth", DATABASE_URL_AUTH_ENV_VAR],
  ["tenant", "DATABASE_URL_TENANT"],
  ["fleet", "DATABASE_URL_FLEET"],
] as const;

export function resolveDatabaseUrls(env: Record<string, string | undefined>): DatabaseUrls {
  const missing = REQUIRED.filter(([, envVar]) => !env[envVar]).map(([, envVar]) => envVar);
  if (missing.length > 0) {
    throw new Error(
      `F4.16: ${missing.join(", ")} required. DATABASE_URL names the schema owner, ` +
        "which is not policy-filtered on every table, so it is not a fallback for any of these.",
    );
  }
  return {
    auth: env.DATABASE_URL_AUTH as string,
    tenant: env.DATABASE_URL_TENANT as string,
    fleet: env.DATABASE_URL_FLEET as string,
  };
}
