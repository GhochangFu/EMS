import pg from "pg";
import { expect } from "vitest";

/**
 * `F4.16` / ADR 0043 decision 8 + Amendment 1 — the grant matrix is asserted
 * against `information_schema`, not against the migration text. A migration that
 * says `REVOKE SELECT (password_hash)` after a table-level `GRANT SELECT` reads
 * correct and does nothing; only the catalogue knows.
 *
 * The catalogue is necessary but not sufficient, so
 * `assertTenantIsDeniedPasswordHashAtRuntime` re-asks the question the way the
 * server answers it: `SET LOCAL ROLE bms_tenant`, then run the select. The roles
 * are `NOLOGIN` until `pnpm db:roles` runs, but `NOLOGIN` only blocks
 * *connecting* — `SET ROLE` works today and is how this suite proves the revoke
 * bites rather than merely appearing to.
 *
 * Every assertion that expects an empty result carries a positive control run
 * through the same query, because an empty result is also what a typo, a missing
 * `USAGE` or an unseeded table looks like.
 */

/** Roles named by ADR 0043 decision 8, in the order `order by rolname` returns. */
const ROLE_NAMES = ["bms_auth", "bms_fleet", "bms_tenant"] as const;

/** Columns of `bms.users` every non-auth role may read. `password_hash` is absent by design. */
const NON_SECRET_USER_COLUMNS = [
  "id",
  "email",
  "display_name",
  "role",
  "oidc_subject",
  "last_login_at",
  "created_at",
] as const;

export async function assertRolesExist(pool: pg.Pool): Promise<void> {
  // `rolcanlogin` is intentionally not asserted: the roles are NOLOGIN here and
  // Task 2 (`pnpm db:roles`) flips them to LOGIN, so pinning it would make this
  // suite fail the moment the operational step runs.
  const { rows } = await pool.query<{ rolname: string; rolbypassrls: boolean }>(
    `select rolname, rolbypassrls from pg_roles
      where rolname in ('bms_tenant', 'bms_fleet', 'bms_auth')
      order by rolname`,
  );
  expect(rows.map((r) => r.rolname)).toEqual([...ROLE_NAMES]);

  const bypassByName = new Map(rows.map((r) => [r.rolname, r.rolbypassrls]));
  // Decision 12: the fleet bypass is a role attribute, not a policy exemption.
  // FORCE ROW LEVEL SECURITY constrains the table owner and does not restrain it.
  expect(bypassByName.get("bms_fleet")).toBe(true);
  expect(bypassByName.get("bms_tenant")).toBe(false);
  expect(bypassByName.get("bms_auth")).toBe(false);
}

export async function assertTenantCannotReadPasswordHash(pool: pg.Pool): Promise<void> {
  const columns = await selectableColumns(pool, "bms_tenant");
  expect(columns).not.toContain("password_hash");
  // Positive control: an empty grant list would also satisfy `not.toContain`.
  expect(columns).toEqual(expect.arrayContaining([...NON_SECRET_USER_COLUMNS]));
}

export async function assertFleetCannotReadPasswordHash(pool: pg.Pool): Promise<void> {
  const columns = await selectableColumns(pool, "bms_fleet");
  expect(columns).not.toContain("password_hash");
  expect(columns).toEqual(expect.arrayContaining([...NON_SECRET_USER_COLUMNS]));
}

export async function assertAuthCanReadPasswordHash(pool: pg.Pool): Promise<void> {
  const columns = await selectableColumns(pool, "bms_auth");
  expect(columns).toContain("password_hash");
}

/**
 * Decision 5 by a second door. Withholding `SELECT (password_hash)` is pointless
 * while the blanket `GRANT ... ON ALL TABLES IN SCHEMA bms` still lets the same
 * role `INSERT` a row carrying an attacker-chosen hash, or `DELETE` the row an
 * administrator authenticates with. No request path creates or removes a
 * `bms.users` row — only `packages/db/src/demo-users-seed.ts` does, and the seed
 * runs as the owner `bms_app` — so both privileges come back off every pool role.
 */
export async function assertNoRoleCanInsertOrDeleteUsers(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ grantee: string; privilege_type: string }>(
    `select grantee, privilege_type from information_schema.table_privileges
      where table_schema = 'bms' and table_name = 'users'
        and grantee in ('bms_tenant', 'bms_fleet', 'bms_auth')
        and privilege_type in ('INSERT', 'DELETE')
      order by grantee, privilege_type`,
  );
  expect(rows).toEqual([]);

  // Positive control through the same query shape: the blanket grant does reach
  // an ordinary table, so the empty result above is a revoke, not a typo.
  const { rows: control } = await pool.query<{ privilege_type: string }>(
    `select privilege_type from information_schema.table_privileges
      where table_schema = 'bms' and table_name = 'locations'
        and grantee = 'bms_tenant' and privilege_type in ('INSERT', 'DELETE')
      order by privilege_type`,
  );
  expect(control.map((r) => r.privilege_type)).toEqual(["DELETE", "INSERT"]);
}

/**
 * `bms_auth` reaches the four identity tables because it was granted four
 * tables, and reaches nothing else. Asserted directly rather than trusted: this
 * is the whole justification for a third role over reusing `bms_fleet`.
 *
 * The four are `users` (the credential and the role) plus
 * `user_organization_access`, `user_location_access` and `locations`, which the
 * identity bootstrap walks to find the home organization until `E7.1` puts
 * `organization_id` on `bms.users`. When that column lands, the last three
 * grants come back out and this assertion narrows to one table.
 */
export async function assertAuthReachesOnlyIdentityTables(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ table_schema: string; table_name: string }>(
    `select distinct table_schema, table_name from information_schema.table_privileges
      where grantee = 'bms_auth'
     union
     select distinct table_schema, table_name from information_schema.column_privileges
      where grantee = 'bms_auth'
     order by table_schema, table_name`,
  );
  expect(rows).toEqual([
    { table_schema: "bms", table_name: "locations" },
    { table_schema: "bms", table_name: "user_location_access" },
    { table_schema: "bms", table_name: "user_organization_access" },
    { table_schema: "bms", table_name: "users" },
  ]);
}

/**
 * The catalogue says the column grant is absent; this says the server refuses
 * the query. They are different claims, and only the second one is the control.
 */
export async function assertTenantIsDeniedPasswordHashAtRuntime(pool: pg.Pool): Promise<void> {
  await asRole(pool, "bms_tenant", async (client) => {
    // Positive control first: the role reaches the table, so the denial that
    // follows is about one column and not about the table or the schema.
    await client.query("select id, email from bms.users limit 1");

    await expect(client.query("select password_hash from bms.users limit 1")).rejects.toThrow(
      /permission denied/i,
    );
  });
}

/** The same denial for `bms_fleet`, whose `BYPASSRLS` does not grant it columns. */
export async function assertFleetIsDeniedPasswordHashAtRuntime(pool: pg.Pool): Promise<void> {
  await asRole(pool, "bms_fleet", async (client) => {
    await client.query("select id, email from bms.users limit 1");

    await expect(client.query("select password_hash from bms.users limit 1")).rejects.toThrow(
      /permission denied/i,
    );
  });
}

/**
 * `GRANT ... ON ALL TABLES IN SCHEMA telemetry` names the hypertable parent and
 * the continuous-aggregate views. Chunks live in `_timescaledb_internal` and the
 * aggregates read a materialisation hypertable, neither of which the grant
 * mentions. Whether TimescaleDB propagates the grant is a property of the
 * extension, not of this migration, so it is asserted here rather than assumed —
 * Task 4 puts real request traffic on this role and a surprise then is expensive.
 */
export async function assertTenantReachesTelemetry(pool: pg.Pool): Promise<void> {
  await asRole(pool, "bms_tenant", async (client) => {
    await client.query("select count(*) from telemetry.point_values");
    await client.query("select count(*) from telemetry.point_values_1h");
  });
}

/** `SELECT` column grants held by `role` on `bms.users`, per the catalogue. */
async function selectableColumns(pool: pg.Pool, role: string): Promise<string[]> {
  const { rows } = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.column_privileges
      where grantee = $1 and table_schema = 'bms'
        and table_name = 'users' and privilege_type = 'SELECT'
      order by column_name`,
    [role],
  );
  return rows.map((r) => r.column_name);
}

/**
 * Run `fn` on one connection with `SET LOCAL ROLE role`, then roll back. The
 * transaction is what makes the role change local — a bare `SET ROLE` would
 * outlive the checkout and hand the next borrower of this pooled connection a
 * silently downgraded session, which is the same defect ADR 0043 decision 10
 * exists to prevent.
 */
async function asRole(
  pool: pg.Pool,
  role: string,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  // `SET ROLE` takes no bind parameter, so the name is interpolated. It is
  // checked against the ADR's own list rather than merely being a local
  // constant, so the safety survives someone adding a caller later.
  if (!ROLE_NAMES.includes(role as (typeof ROLE_NAMES)[number])) {
    throw new Error(`F4.16: refusing to SET ROLE to an unlisted role: ${role}`);
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    await fn(client);
  } finally {
    // The denial assertions abort the transaction, so this rolls back a failed
    // transaction as often as a good one. Both are fine; neither is committed.
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}
