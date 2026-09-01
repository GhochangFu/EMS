import type pg from "pg";

/**
 * `E7.1a` / ADR 0045 — `FORCE ROW LEVEL SECURITY` binds the schema owner.
 *
 * **This suite exists because nothing else asserts the one behaviour the item
 * was built to produce.** Every other integration suite reaches the database on
 * `bms_fleet` (`BYPASSRLS`), `bms_tenant` or the provisioning superuser, so a
 * regression that made `bms_owner` unconstrained again — a dropped `FORCE`, a
 * `BYPASSRLS` granted by a later migration, an aggregate or table added without
 * a policy — would leave the whole suite green.
 *
 * The negative is the evidence and the positive is what stops it being vacuous:
 * a connection that is simply broken also returns zero rows.
 *
 * Before ADR 0045 the owner saw 17 locations here; the counts below are asserted
 * as relationships rather than as literals, so seeding more demo data does not
 * turn this red for the wrong reason.
 */

/**
 * The tables migration `0040` protects and `0041` puts `FORCE` on.
 *
 * **`F3.39` — `point_keys` left this list, and it is the only member ever to
 * do so.** Migration `0057` drops its policy, its FORCE flag and its
 * `organization_id`, moving it into the global-vocabulary class beside
 * `bms.asset_roles` and `bms.dashboard_sections` (ADR 0051 decision 2). Leaving
 * it here would have asserted the exact opposite of what the database now does.
 * The removal is deliberate; do not restore it by symmetry with `0040`.
 */
export const FORCED_TABLES = [
  "locations",
  "user_organization_access",
  "asset_templates",
  "onboarding_sessions",
] as const;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `ENABLE` exempts the table owner; `FORCE` does not. ADR 0043 decision 8 asked
 * for both, `F4.16` shipped only `ENABLE` because `bms_app` was a superuser and
 * `FORCE` would have been decorative, and this is the assertion that says the
 * second half actually landed.
 */
export async function assertForceIsSetOnEveryTenantTable(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
      WHERE relnamespace = 'bms'::regnamespace
        AND relname = ANY($1::text[])`,
    [[...FORCED_TABLES]],
  );

  assert(
    rows.length === FORCED_TABLES.length,
    `expected ${FORCED_TABLES.length} tenant tables, found ${rows.length}`,
  );
  const unforced = rows
    .filter((r) => !r.relrowsecurity || !r.relforcerowsecurity)
    .map((r) => r.relname);
  assert(
    unforced.length === 0,
    `tables without ENABLE+FORCE ROW LEVEL SECURITY: ${unforced.join(", ")}. ` +
      "Without FORCE the schema owner is exempt from its own tenant policy, which " +
      "is the defect ADR 0045 exists to remove.",
  );
}

/**
 * The owner must not be a superuser and must not hold `BYPASSRLS`. Either one
 * makes every assertion below pass for the wrong reason — a superuser bypasses
 * RLS regardless of `FORCE`, which is exactly how `F4.16` shipped a control that
 * did nothing.
 */
export async function assertTheOwnerIsNotPrivilegedOutOfItsOwnPolicies(
  pool: pg.Pool,
): Promise<void> {
  const { rows } = await pool.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    inherits_rollup: boolean;
  }>(`
    SELECT rolname, rolsuper, rolbypassrls,
           pg_has_role(rolname, 'bms_rollup', 'USAGE') AS inherits_rollup
      FROM pg_roles WHERE rolname = current_user
  `);
  const me = rows[0];
  assert(me !== undefined, "could not read the current role");
  assert(me.rolname === "bms_owner", `expected to connect as bms_owner, got ${me.rolname}`);
  assert(!me.rolsuper, "bms_owner is a SUPERUSER — it would bypass every policy");
  assert(!me.rolbypassrls, "bms_owner holds BYPASSRLS — FORCE does not restrain that");
  // ADR 0045 Amendment 2: the bms_rollup membership must be `WITH INHERIT FALSE`.
  // An inheriting grant hands the aggregate owner's rights to every statement,
  // which is how a closing review found bms_tenant could DROP a rollup outright.
  assert(
    !me.inherits_rollup,
    "bms_owner inherits bms_rollup — the membership must be WITH INHERIT FALSE, " +
      "so those rights exist only inside an explicit SET ROLE",
  );
}

/**
 * The negative, and the actual evidence that the item worked: with no
 * `app.current_organization`, the policy compares `organization_id` to NULL,
 * that comparison is NULL rather than true, and the owner sees nothing.
 */
export async function assertTheOwnerSeesNothingWithoutATenantContext(
  pool: pg.Pool,
): Promise<void> {
  for (const table of FORCED_TABLES) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM bms.${table}`,
    );
    assert(
      rows[0]?.n === "0",
      `bms.${table} returned ${rows[0]?.n ?? "no row"} rows to the owner with no ` +
        "tenant context; FORCE ROW LEVEL SECURITY is not binding.",
    );
  }
}

/** A write must be refused too — reads alone would leave the WITH CHECK untested. */
export async function assertTheOwnerCannotWriteWithoutATenantContext(
  pool: pg.Pool,
): Promise<void> {
  const org = await pool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
  );
  const organizationId = org.rows[0]?.id;
  assert(organizationId !== undefined, "no ESKOM organization — run pnpm db:seed");

  let rejected = false;
  try {
    await pool.query(
      `INSERT INTO bms.locations
         (organization_id, code, slug, name, type, province, latitude, longitude, active)
       VALUES ($1, 'E71A-RLS-PROBE', 'e71a-rls-probe', 'RLS probe', 'smoc_campus',
               'Gauteng', -26.2041, 28.0473, true)`,
      [organizationId],
    );
  } catch {
    rejected = true;
  }
  if (!rejected) {
    // Never leave the row behind, even though the insert succeeding is already a
    // failure — a stray fixture would break the next run somewhere unrelated.
    await pool.query(`DELETE FROM bms.locations WHERE code = 'E71A-RLS-PROBE'`);
  }
  assert(
    rejected,
    "the owner inserted into bms.locations with no tenant context; the policy's " +
      "WITH CHECK is not binding.",
  );
}

/**
 * The positive direction. Without it the negative above proves only that the
 * connection is broken, which is the classic way an RLS test passes vacuously.
 *
 * Asserted as a relationship, not a literal: each organization sees a non-zero
 * subset, the two subsets are disjoint, and together they account for every row.
 */
export async function assertATenantContextRevealsExactlyThatOrganisation(
  pool: pg.Pool,
): Promise<void> {
  const orgs = await pool.query<{ code: string; id: string }>(
    `SELECT code, id FROM bms.organizations ORDER BY code`,
  );
  assert(orgs.rows.length >= 2, "need at least two organizations — run pnpm db:seed");

  const client = await pool.connect();
  const seen: Array<{ code: string; n: number }> = [];
  try {
    for (const { code, id } of orgs.rows) {
      await client.query("BEGIN");
      try {
        await client.query("select set_config('app.current_organization', $1, true)", [id]);
        const { rows } = await client.query<{ n: string; foreign_rows: string }>(
          `SELECT count(*)::text AS n,
                  count(*) FILTER (WHERE organization_id <> $1)::text AS foreign_rows
             FROM bms.locations`,
          [id],
        );
        assert(
          rows[0]?.foreign_rows === "0",
          `under the ${code} context the owner saw ${rows[0]?.foreign_rows} rows ` +
            "belonging to another organization",
        );
        seen.push({ code, n: Number(rows[0]?.n ?? "0") });
      } finally {
        await client.query("COMMIT");
      }
    }
  } finally {
    client.release();
  }

  const withRows = seen.filter((s) => s.n > 0);
  assert(
    withRows.length >= 2,
    `only ${withRows.length} organization(s) had visible locations (${seen
      .map((s) => `${s.code}=${s.n}`)
      .join(", ")}); the split cannot be told from a broken connection.`,
  );
}
