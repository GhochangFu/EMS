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
 * Since `E7.1b` / ADR 0043 Amendment 4 that is a single table: `bms.users`,
 * which now carries `organization_id`, so the identity bootstrap resolves the
 * home organization from the user row instead of walking the grant tables.
 * `0047` therefore dropped `bms_auth`'s SELECT on `user_organization_access`,
 * `user_location_access` and `locations` (0039:122-124) — the standing removal
 * Amendment 1 promised. This asserts the narrowed set *positively* (exactly
 * `bms.users`, nothing more), so a future migration that re-widens `bms_auth`
 * fails here rather than silently.
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
  expect(rows).toEqual([{ table_schema: "bms", table_name: "users" }]);
}

/**
 * `E7.1b` / ADR 0043 Amendment 4 — `bms_auth`'s only write on `bms.users` is
 * `UPDATE (last_login_at)` (0039:113). That column grant is the SOLE containment
 * for `0047`'s `auth_bootstrap_write` policy, which is row-unrestricted
 * (`USING (true) WITH CHECK (true)`) so `AuthService.login` can stamp any user's
 * `last_login_at` before any tenant context exists. Asserted positively (exactly
 * that one column, nothing more), so a future migration widening `bms_auth`'s
 * UPDATE columns — which would let it rewrite `role` / `email` /
 * `organization_id` on any user row fleet-wide — fails here rather than silently.
 */
export async function assertAuthCanUpdateOnlyLastLogin(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.column_privileges
      where grantee = 'bms_auth' and table_schema = 'bms'
        and table_name = 'users' and privilege_type = 'UPDATE'
      order by column_name`,
  );
  expect(rows.map((r) => r.column_name)).toEqual(["last_login_at"]);
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
 * ADR 0051 Amendment 1 decision 1 — a tenant may **extend** the fleet-wide
 * point-key catalog and may not **edit** it, and migration `0059` is what makes
 * the database say so.
 *
 * This assertion exists because `bms.point_keys` is the one table where the
 * grant is the whole control. `0057` made the catalog global by dropping its
 * `tenant_isolation` policy and FORCE flag, and `0041:112`'s default privilege
 * had already given `bms_tenant` all four verbs on every `bms` table. Nothing
 * else was left to stop an `UPDATE`, and one — `SET active = false` — retires a
 * code for every organization at once, refusing every other tenant's template
 * publish through `assertPointKeysActive` until a global administrator undoes
 * it.
 *
 * **All four verbs are asserted, not just the two removed.** A revoke that took
 * SELECT would break every tenant's read of the vocabulary, and one that took
 * INSERT would break the onboarding extension Amendment 1 exists to permit —
 * both silently, since neither is what this row was watching for.
 */
export async function assertTenantCannotEditPointKeys(pool: pg.Pool): Promise<void> {
  const held = async (verb: string): Promise<boolean> => {
    const { rows } = await pool.query<{ ok: boolean }>(
      `select has_table_privilege('bms_tenant', 'bms.point_keys', $1) as ok`,
      [verb],
    );
    return rows[0]?.ok === true;
  };

  // `has_table_privilege` rather than `information_schema.table_privileges`:
  // the information schema lists only grants whose grantor or grantee is a
  // currently enabled role, so it reports an empty set both for a revoked
  // privilege and for one this connection simply cannot see. It also follows
  // role membership, so a privilege reached through some other role is caught.
  expect(await held("UPDATE"), "bms_tenant can UPDATE bms.point_keys").toBe(false);
  expect(await held("DELETE"), "bms_tenant can DELETE bms.point_keys").toBe(false);
  expect(await held("SELECT"), "bms_tenant lost SELECT on bms.point_keys").toBe(true);
  expect(
    await held("INSERT"),
    "bms_tenant lost INSERT on bms.point_keys — that is ADR 0051 Amendment 1's " +
      "authorised onboarding extension path, not an oversight",
  ).toBe(true);

  // Positive control on a sibling table `0059` does not touch. Without it, a
  // revoke applied to the whole schema by mistake reads identically to the
  // narrow one this row intends.
  const { rows: control } = await pool.query<{ ok: boolean }>(
    `select has_table_privilege('bms_tenant', 'bms.asset_roles', 'UPDATE') as ok`,
  );
  expect(
    control[0]?.ok,
    "bms_tenant lost UPDATE on bms.asset_roles too. 0059 must narrow one table, " +
      "and the rest of the global-vocabulary class has no tenant-pool writer to " +
      "justify the same treatment yet.",
  ).toBe(true);
}

/**
 * The catalogue says the two verbs are gone; this says the server refuses the
 * statement. Different claims, and only the second is the control.
 */
export async function assertTenantIsRefusedAPointKeyEditAtRuntime(pool: pg.Pool): Promise<void> {
  // **One denial per transaction, which is why this is two blocks and not one.**
  // A refused statement aborts the transaction, so a second `expect` inside the
  // same `asRole` receives `current transaction is aborted` instead of
  // `permission denied` — a failure that looks like the revoke not biting when
  // it is only the first refusal still standing. Measured, not predicted: the
  // one-block version of this failed exactly that way.
  //
  // `where false` on both statements. The claim is that the privilege check
  // refuses the statement, and PostgreSQL checks table privileges before it
  // plans the predicate — so a held privilege reaches zero rows and passes
  // quietly rather than editing the shared catalog under a test.
  await asRole(pool, "bms_tenant", async (client) => {
    // Positive control first, so the refusal is about the verb and not about
    // the table, the schema or a missing USAGE.
    //
    // `count(*)` and not `select code … limit 1`, which is what this was until
    // `F4.53` caught it: a bare `LIMIT 1` in a scanned `.spec` resolves a row
    // positionally, and the rule does not care that this one throws its row
    // away. `count(*)` needs the same SELECT privilege and the same schema
    // USAGE, and resolves nothing — the shape `assertTenantReachesTelemetry`
    // below already uses.
    await client.query("select count(*) from bms.point_keys");

    await expect(
      client.query("update bms.point_keys set active = false where false"),
      "bms_tenant updated bms.point_keys. Migration 0059's REVOKE did not bite.",
    ).rejects.toThrow(/permission denied/i);
  });

  await asRole(pool, "bms_tenant", async (client) => {
    await client.query("select count(*) from bms.point_keys");

    await expect(
      client.query("delete from bms.point_keys where false"),
      "bms_tenant deleted from bms.point_keys. Migration 0059's REVOKE did not bite.",
    ).rejects.toThrow(/permission denied/i);
  });

  // And the verb that must SURVIVE, proved the same way. A revoke that took
  // INSERT would break ADR 0051 Amendment 1's onboarding extension path, and
  // the two refusals above would still pass. `where false` has no INSERT form,
  // so this rolls back inside `asRole` like every other block here.
  await asRole(pool, "bms_tenant", async (client) => {
    await client.query(
      `insert into bms.point_keys (code, name, active)
       values ('f-0059-insert-probe', 'F 0059 Insert Probe', true)`,
    );
  });
}

/**
 * `F3.68` / migration `0084` — the INSERT `bms_tenant` keeps may not carry a
 * `headline_rank`. The rank orders every organization's generated site card, so
 * it is fleet-wide master data; a trigger refuses it rather than a column grant,
 * because Drizzle's `.insert()` names every column (`headline_rank` as `DEFAULT`)
 * and a column grant would refuse onboarding's whole insert.
 *
 * The statement below is the shape Drizzle sends for
 * `OnboardingCommitService`'s point-key insert: every column named, `DEFAULT`
 * for the unset ones. Each case uses its own code, so a unique violation can
 * never stand in for the result.
 */
function drizzleShapedPointKeyInsert(code: string, rank: "default" | number): string {
  if (!/^[a-z0-9-]+$/.test(code)) throw new Error(`F3.68: unexpected probe code ${code}`);
  const rankSql = rank === "default" ? "default" : String(Math.trunc(rank));
  return (
    `insert into "bms"."point_keys" ` +
    `("id", "code", "name", "domain", "unit", "description", "active", "created_at", "headline_rank") ` +
    `values (default, '${code}', 'F3.68 rank probe', null, null, null, true, default, ${rankSql})`
  );
}

/** Asserts `promise` is the 0084 trigger's refusal — code and message both. */
async function expectRankRefusal(promise: Promise<unknown>, because: string): Promise<void> {
  // 42501 alone is not enough: a revoked INSERT is also 42501 ("permission
  // denied for table point_keys"). The message names the column only when the
  // trigger fired.
  await expect(promise, because).rejects.toMatchObject({
    code: "42501",
    message: expect.stringMatching(/may not set bms\.point_keys\.headline_rank/),
  });
}

/** Positive control: a tenant insert naming `headline_rank` as DEFAULT still lands. */
export async function assertTenantCanInsertAnUnrankedPointKey(pool: pg.Pool): Promise<void> {
  await asRole(pool, "bms_tenant", async (client) => {
    const res = await client.query(drizzleShapedPointKeyInsert("f3-68-tenant-unranked", "default"));
    expect(res.rowCount, "the Drizzle-shaped unranked insert must land for bms_tenant").toBe(1);
  });
}

export async function assertTenantIsRefusedARankedPointKey(pool: pg.Pool): Promise<void> {
  await asRole(pool, "bms_tenant", async (client) => {
    // Positive control first, in the same transaction: the role can insert
    // into the table at all, so the refusal below is about the rank.
    await client.query(drizzleShapedPointKeyInsert("f3-68-tenant-control", "default"));

    // Nothing may follow this: the refusal aborts the transaction.
    await expectRankRefusal(
      client.query(drizzleShapedPointKeyInsert("f3-68-tenant-ranked", 5)),
      "bms_tenant inserted a point key with headline_rank = 5. Migration 0084's trigger did not bite.",
    );
  });
}

export async function assertFleetCanInsertARankedPointKey(pool: pg.Pool): Promise<void> {
  await asRole(pool, "bms_fleet", async (client) => {
    const res = await client.query(drizzleShapedPointKeyInsert("f3-68-fleet-ranked", 5));
    expect(res.rowCount, "bms_fleet (the admin API pool) must still insert a ranked point key").toBe(1);
  });
}

/**
 * The migrator's role. Run on the pool's own superuser connection, rolled
 * back. Not the seed: `packages/db/src/seed.ts` connects as `DATABASE_URL`,
 * which is `bms_owner` in CI, and it sets ranks with an `UPDATE`, which this
 * `BEFORE INSERT` trigger never sees. `pnpm db:migrate` is what runs as this
 * connection's role (the gate's `connection: "superuser"`), inside the migration's own
 * `SET ROLE bms_owner` / `RESET ROLE` bracket — this case proves the bracket's
 * outer role, not the seed.
 */
export async function assertSuperuserCanInsertARankedPointKey(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ u: string; s: boolean }>(
      "select current_user as u, (select rolsuper from pg_roles where rolname = current_user) as s",
    );
    // The claim is about a superuser; a pool that connected as something else
    // would make this case prove nothing.
    expect(rows[0]?.s, `the pool connected as ${rows[0]?.u}, not a superuser`).toBe(true);
    const res = await client.query(drizzleShapedPointKeyInsert("f3-68-super-ranked", 5));
    expect(res.rowCount, "the superuser (the migrator) must still insert a ranked point key").toBe(1);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/**
 * `bms_owner` — the table owner and what `DATABASE_URL` names since ADR 0045
 * — is unaffected by the trigger's `current_user = 'bms_tenant'` check
 * (0084:33), so its own INSERT still lands a rank. Proved with the suite's
 * `asRole` helper (`SET LOCAL ROLE bms_owner`, rolled back) rather than a
 * second pool connection, matching every other role case in this file.
 */
export async function assertOwnerCanInsertARankedPointKey(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role bms_owner");
    const res = await client.query(drizzleShapedPointKeyInsert("f3-68-owner-ranked", 5));
    expect(res.rowCount, "bms_owner must still insert a ranked point key").toBe(1);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
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
