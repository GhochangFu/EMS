import pg from "pg";

/**
 * `E7.1a` / ADR 0045 decision 5 — the seed becomes organization-aware.
 *
 * Before this item `pnpm db:seed` ran as `bms_app`, a superuser, so row-level
 * security never applied to it and its bulk arrays could span both seeded
 * organizations freely. It now runs as `bms_owner`, which `FORCE ROW LEVEL
 * SECURITY` binds. With no `app.current_organization` set, the `tenant_isolation`
 * policy compares `organization_id` to NULL, that comparison is NULL rather than
 * true, and the role sees **zero** rows and cannot insert one.
 *
 * ## Why `set_config(..., true)` and not `SET`
 *
 * `true` is the `is_local` argument: it scopes the setting to the enclosing
 * transaction, exactly as `SET LOCAL` does. A session-level `SET` on a pooled
 * connection outlives the work that set it and leaks into whatever runs next —
 * which for a seed means one organization's rows landing under another's
 * identity, silently. `apps/api/src/database/tenant-context.ts` uses the same
 * form for the same reason; this is that rule applied to the seed.
 *
 * ## Why the pool must be `max: 1`
 *
 * The transaction lives on one backend connection. The seed's sibling modules
 * take a `pg.Pool` and call `pool.query` directly — none of them checks out its
 * own client — so they only join this transaction if the pool can hand out no
 * other connection. `createSeedPool` enforces that and `withOrganization`
 * asserts it, because the failure is silent in the worst way: the statements
 * would run outside the transaction, see no tenant GUC, and quietly write or
 * match nothing.
 */

/** The `is_local = true` argument is the whole point. Do not change it. */
const SET_TENANT_SQL = "select set_config('app.current_organization', $1, true)";

/**
 * The seed's pool. `max: 1` is load-bearing, not a performance choice — see the
 * module header.
 */
export function createSeedPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 1 });
}

/** Narrow structural view of the parts of `pg.Pool` this module uses. */
export interface SeedQueryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
  readonly options?: { readonly max?: number };
}

export function assertSingleConnectionPool(pool: SeedQueryable): void {
  const max = pool.options?.max;
  if (max !== 1) {
    throw new Error(
      `The seed pool must be created with max: 1 (got ${String(max)}). ` +
        "withOrganization opens a transaction on one connection, and the seed " +
        "modules query the pool directly; a second connection would run their " +
        "statements outside that transaction, with no tenant context and no error.",
    );
  }
}

/**
 * Runs `work` inside one transaction with `app.current_organization` set to
 * `organizationId` for its duration.
 *
 * `work` takes no argument on purpose: every seed module already holds the pool,
 * and with `max: 1` its queries land on this transaction's connection. Rolls
 * back and rethrows on failure, so a half-written organization is never left
 * behind.
 */
export async function withOrganization<T>(
  pool: SeedQueryable,
  organizationId: string,
  work: () => Promise<T>,
): Promise<T> {
  assertSingleConnectionPool(pool);
  await pool.query("BEGIN");
  try {
    await pool.query(SET_TENANT_SQL, [organizationId]);
    const result = await work();
    await pool.query("COMMIT");
    return result;
  } catch (err: unknown) {
    await pool.query("ROLLBACK");
    throw err;
  }
}
