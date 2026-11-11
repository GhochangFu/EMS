/**
 * `F4.5` (ADR 0124 decisions 3–4) — the environment one Vitest worker runs under.
 *
 * Every integration suite derives its role connections from `DATABASE_URL` the same way:
 * an explicit `DATABASE_URL_<ROLE>` wins, otherwise the user and password are swapped to the
 * role's dev credentials (`resolveIntegrationRoleUrl`, and `asRole(url, "bms_tenant", …)` in
 * about 140 files). `resolveRoleUrls` reproduces that, so the harness hands each worker the same
 * five connections a suite would have built — with only the database name changed. Setting all
 * five explicitly means no suite can fall back to a derivation that misses the worker's
 * database.
 */

export type RoleUrls = {
  readonly owner: string;
  readonly superuser: string;
  readonly fleet: string;
  readonly auth: string;
  readonly tenant: string;
};

export type RoleUrlEnv = {
  readonly DATABASE_URL?: string | undefined;
  readonly DATABASE_URL_SUPERUSER?: string | undefined;
  readonly DATABASE_URL_FLEET?: string | undefined;
  readonly DATABASE_URL_AUTH?: string | undefined;
  readonly DATABASE_URL_TENANT?: string | undefined;
  readonly BMS_FLEET_PASSWORD?: string | undefined;
};

/** Redis has databases 0–15; index 0 stays unused, so at most 15 workers. */
export const MAX_ISOLATED_WORKERS = 15;

/**
 * A run's databases share one prefix: `bms` on a run's own container, `bms_t<run id>` on an
 * external server two runs may share (two worktrees, a watch beside a full run), so neither run
 * can create, use or drop the other's databases.
 */
export function assertDatabasePrefix(prefix: string): string {
  if (!/^bms(_t[a-z0-9]{6,12})?$/.test(prefix)) {
    throw new Error(`F4.5: database prefix ${JSON.stringify(prefix)} is not bms or bms_t<run id>.`);
  }
  return prefix;
}

/** `<prefix>_w<VITEST_POOL_ID>`, refusing a pool id outside 1–15. */
export function workerDatabaseName(poolId: string | undefined, prefix = "bms"): string {
  assertDatabasePrefix(prefix);
  const id = poolId !== undefined && /^[0-9]+$/.test(poolId) ? Number(poolId) : Number.NaN;
  if (!Number.isInteger(id) || id < 1 || id > MAX_ISOLATED_WORKERS) {
    throw new Error(
      `F4.5: VITEST_POOL_ID must be an integer from 1 to ${MAX_ISOLATED_WORKERS}, got ` +
        `${JSON.stringify(poolId)}. Keep maxWorkers at or under ${MAX_ISOLATED_WORKERS}.`,
    );
  }
  return `${prefix}_w${id}`;
}

/** The same URL with only its database name replaced. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function asRole(url: string, role: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

/** An explicit, non-blank value wins; blank counts as unset, as `resolveIntegrationRoleUrl` treats it. */
function explicit(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The five role URLs a suite would derive from this environment, before the database is swapped. */
export function resolveRoleUrls(env: RoleUrlEnv): RoleUrls {
  const owner = explicit(env.DATABASE_URL);
  if (!owner) {
    throw new Error("F4.5: resolveRoleUrls needs DATABASE_URL.");
  }
  return {
    owner,
    superuser: explicit(env.DATABASE_URL_SUPERUSER) ?? asRole(owner, "bms_app", "bms_app_dev"),
    fleet:
      explicit(env.DATABASE_URL_FLEET) ??
      asRole(owner, "bms_fleet", explicit(env.BMS_FLEET_PASSWORD) ?? "bms_fleet_dev"),
    auth: explicit(env.DATABASE_URL_AUTH) ?? asRole(owner, "bms_auth", "bms_auth_dev"),
    tenant: explicit(env.DATABASE_URL_TENANT) ?? asRole(owner, "bms_tenant", "bms_tenant_dev"),
  };
}

/** The environment one worker runs under: all five role URLs on its database, its own Redis index. */
export function workerDatabaseEnv(
  roles: RoleUrls,
  database: string,
  redisUrl: string,
  redisIndex: number,
): Record<string, string> {
  const redis = new URL(redisUrl);
  redis.pathname = `/${redisIndex}`;
  return {
    DATABASE_URL: withDatabase(roles.owner, database),
    DATABASE_URL_SUPERUSER: withDatabase(roles.superuser, database),
    DATABASE_URL_FLEET: withDatabase(roles.fleet, database),
    DATABASE_URL_AUTH: withDatabase(roles.auth, database),
    DATABASE_URL_TENANT: withDatabase(roles.tenant, database),
    REDIS_URL: redis.toString(),
  };
}
