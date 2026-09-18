import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `E4.1a` / ADR 0070 decision 2 — what migration `0074` guarantees against a
 * real database. `tests/e4.1a-calc-parameters-schema.test.ts` asserts the
 * migration's *text*; this asserts what Postgres actually enforces, following
 * `tests/f3.2-asset-dashboards-schema.integration.test.ts`'s lifecycle:
 * superuser pool, one held client, one rolled-back transaction per case, a
 * per-probe `SAVEPOINT`, every code suffixed with a per-run `randomUUID()`.
 *
 * **Every case rolls back** — `tests/f3.60-withrollback-cases-roll-back.test.ts`
 * exists because a case that merely returns COMMITS. Each case also mints its
 * own vocabulary key (`e41a_<case>_<run>`) inside the transaction, so its
 * rows are prefixed by construction and no committed row can satisfy a count.
 *
 * **Roles.** `bms_fleet` holds `BYPASSRLS` (`roles.ts`), so a fleet-pool case
 * proves nothing about the policy: I7 runs as `bms_tenant`. I5 counts as
 * `bms_fleet` and asserts `current_user` in the same case, because `FORCE ROW
 * LEVEL SECURITY` returns 0 to the owner on a tenant table and the habit must
 * hold even on the global keys table.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "E4.1a",
  label: "calc parameter schema tests",
  because:
    "the scope check, the validity check, the finite check, the btree_gist exclusion, the " +
    "vocabulary FK and the tenant_isolation policy's two parent legs are all things Postgres " +
    "enforces, so a green run without a database asserts nothing about any of them.",
  connection: "superuser",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";
const NIL = "00000000-0000-0000-0000-000000000000";

const STOCK_KEYS = [
  "energy_tariff_per_kwh",
  "water_tariff_per_kl",
  "effluent_tariff_per_kl",
  "grid_carbon_factor_kgco2_per_kwh",
  "energy_baseline_kwh_per_day",
  "water_baseline_kl_per_day",
  "chemical_baseline_kg_per_day",
  "rated_kw",
  "installed_kwp",
  "contract_demand_kva",
  "tank_capacity_l",
  "tariff_pf_band",
];

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Row = Record<string, unknown>;
type Run = (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
type IntegrationClient = {
  query: <R extends Row = Row>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }>;
  release: () => void;
};
type PgError = { code?: string; constraint?: string; message?: string };

const T0 = "2026-01-01T00:00:00Z";
const T1 = "2026-02-01T00:00:00Z";
const T2 = "2026-03-01T00:00:00Z";
const T3 = "2026-04-01T00:00:00Z";

describe.skipIf(!has)("E4.1a — calc parameters against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "E4.1a",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query<{ id: string }>(`SELECT id FROM bms.organizations ORDER BY code`);
    if (orgs.rows.length < 2) {
      throw new Error(
        "E4.1a: needs two bms.organizations rows to prove tenant isolation — run pnpm db:seed.",
      );
    }
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const run: Run = (sql, params) => client.query(sql, params);

  /** Runs `body` inside a rolled-back transaction, as `bms_owner` with org A's tenant GUC. */
  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await client.query(`SET LOCAL app.current_organization = '${orgA}'`);
      await body(run);
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** A per-case vocabulary key, minted inside the transaction so the case's rows are prefixed. */
  const mintKey = async (run: Run, caseName: string): Promise<string> => {
    const code = `e41a_${caseName}_${RUN}`;
    await run(`INSERT INTO bms.calc_parameter_keys (code, label) VALUES ($1, $2)`, [code, `E4.1a ${caseName}`]);
    return code;
  };

  const seedAsset = async (run: Run, org: string, codeSuffix: string): Promise<string> => {
    const loc = await run(`SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY code`, [org]);
    const locationId = loc.rows[0]?.id as string;
    if (!locationId) {
      throw new Error(`E4.1a: org ${org} needs a seeded location — run pnpm db:seed.`);
    }
    const domain = await run(`SELECT code FROM bms.asset_domains ORDER BY code`);
    const asset = await run(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [org, locationId, `E41A-${codeSuffix}`, `E4.1a ${codeSuffix}`, "E4.1a", domain.rows[0]?.code],
    );
    return asset.rows[0]?.id as string;
  };

  const INSERT =
    `INSERT INTO bms.calc_parameters (organization_id, key, location_id, asset_id, value, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;

  /** Asserts the SQLSTATE and the constraint name off the error object — not
   * the message, because RLS suppresses a violation's DETAIL (repo memory). */
  const refuses = async (
    run: Run,
    sql: string,
    params: unknown[],
    code: string,
    constraint?: string,
  ): Promise<void> => {
    await run("SAVEPOINT probe");
    let err: PgError | undefined;
    try {
      await run(sql, params);
    } catch (e) {
      err = e as PgError;
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    expect(err?.code, `expected SQLSTATE ${code}${constraint ? ` naming ${constraint}` : ""}`).toBe(code);
    if (constraint) {
      expect(err?.constraint, `expected the refusal to name ${constraint}`).toBe(constraint);
    }
  };

  const accepts = async (run: Run, sql: string, params: unknown[], why: string): Promise<void> => {
    expect((await run(sql, params)).rows.length, why).toBe(1);
  };

  // I1
  it("both tables carry the declared columns, types and nullability", async () => {
    await inTx(async (run) => {
      const columns = async (table: string) =>
        (
          await run(
            `SELECT column_name, data_type, is_nullable FROM information_schema.columns
              WHERE table_schema = 'bms' AND table_name = $1 ORDER BY ordinal_position`,
            [table],
          )
        ).rows.map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}`);

      expect(await columns("calc_parameter_keys")).toEqual([
        "code:character varying:NO",
        "label:character varying:NO",
        "unit:character varying:YES",
        "description:text:YES",
        "sort_order:integer:NO",
        "active:boolean:NO",
        "created_at:timestamp with time zone:NO",
      ]);
      expect(await columns("calc_parameters")).toEqual([
        "id:uuid:NO",
        "organization_id:uuid:NO",
        "key:character varying:NO",
        "location_id:uuid:YES",
        "asset_id:uuid:YES",
        "value:double precision:NO",
        "effective_from:timestamp with time zone:NO",
        "effective_to:timestamp with time zone:YES",
        "created_at:timestamp with time zone:NO",
        "updated_at:timestamp with time zone:NO",
      ]);
    });
  });

  // I2
  it("scope_check permits organization, location or asset scope alone and refuses location + asset", async () => {
    await inTx(async (run) => {
      const key = await mintKey(run, "i2");
      const assetId = await seedAsset(run, orgA, `I2-${RUN}`);
      const loc = await run(`SELECT location_id FROM bms.assets WHERE id = $1`, [assetId]);
      const locationId = loc.rows[0]?.location_id;

      // Positive controls first — each scope alone must be accepted before the
      // refusal proves anything.
      await accepts(run, INSERT, [orgA, key, null, null, 1, T0, null], "organization scope alone");
      await accepts(run, INSERT, [orgA, key, locationId, null, 1, T0, null], "location scope alone");
      await accepts(run, INSERT, [orgA, key, null, assetId, 1, T0, null], "asset scope alone");

      await refuses(
        run,
        INSERT,
        [orgA, key, locationId, assetId, 1, T0, null],
        "23514",
        "calc_parameters_scope_check",
      );
    });
  });

  // I3
  it("validity_check refuses effective_to <= effective_from and accepts a later or NULL effective_to", async () => {
    await inTx(async (run) => {
      const key = await mintKey(run, "i3");
      await accepts(run, INSERT, [orgA, key, null, null, 1, T0, T1], "effective_to after effective_from");
      await accepts(run, INSERT, [orgA, key, null, null, 1, T1, null], "open-ended effective_to");

      await refuses(run, INSERT, [orgA, key, null, null, 1, T2, T2], "23514", "calc_parameters_validity_check");
      await refuses(run, INSERT, [orgA, key, null, null, 1, T3, T2], "23514", "calc_parameters_validity_check");
    });
  });

  // I3b — the plan's `value = value` form is a no-op for NaN in Postgres (0031's
  // header); this case is what tells the two forms apart.
  it("value_finite_check refuses NaN and both infinities, accepts zero and a negative", async () => {
    await inTx(async (run) => {
      const key = await mintKey(run, "i3b");
      await accepts(run, INSERT, [orgA, key, null, null, 0, T0, T1], "zero");
      await accepts(run, INSERT, [orgA, key, null, null, -2.5, T1, T2], "a negative value");

      for (const bad of ["NaN", "Infinity", "-Infinity"]) {
        await refuses(
          run,
          `INSERT INTO bms.calc_parameters (organization_id, key, value, effective_from)
           VALUES ($1, $2, $3::float8, $4)`,
          [orgA, key, bad, T3],
          "23514",
          "calc_parameters_value_finite_check",
        );
      }
    });
  });

  // I4
  it("no_overlap refuses an overlapping same-scope row and accepts abutting and different-scope rows", async () => {
    await inTx(async (run) => {
      const key = await mintKey(run, "i4");
      const otherKey = await mintKey(run, "i4o");
      const assetId = await seedAsset(run, orgA, `I4-${RUN}`);

      await accepts(run, INSERT, [orgA, key, null, null, 1, T0, T1], "the first organization-scope window");

      // Overlapping same scope, same key: [T0,T1) vs [T0+,T2).
      await refuses(
        run,
        INSERT,
        [orgA, key, null, null, 2, "2026-01-15T00:00:00Z", T2],
        "23P01",
        "calc_parameters_no_overlap",
      );
      // The half-open range: an abutting [T1, ∞) is accepted …
      await accepts(run, INSERT, [orgA, key, null, null, 2, T1, null], "abutting [t1, ∞) after [t0, t1)");
      // … and anything after the open end is refused.
      await refuses(run, INSERT, [orgA, key, null, null, 3, T3, null], "23P01", "calc_parameters_no_overlap");
      // Two organization-scope rows (both scope columns NULL) DO conflict — the
      // coalesce-to-nil-uuid trick is what makes NULL = NULL for the exclusion.
      await refuses(run, INSERT, [orgA, key, null, null, 3, T0, T1], "23P01", "calc_parameters_no_overlap");

      // Positive controls: a different scope or a different key at the same window is accepted.
      await accepts(run, INSERT, [orgA, key, null, assetId, 4, T0, T1], "asset scope over the same window");
      await accepts(run, INSERT, [orgA, otherKey, null, null, 5, T0, T1], "another key over the same window");
      // The nil uuid is a sentinel, not a row: the coalesce never collides with a real id.
      const nil = await run(`SELECT 1 FROM bms.assets WHERE id = $1`, [NIL]);
      expect(nil.rows.length).toBe(0);
    });
  });

  // I5 — counted as bms_fleet, asserted in the same case.
  it("as bms_fleet, the twelve stock keys are present and active", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_fleet");
      const who = await run(`SELECT current_user`);
      expect(who.rows[0]?.current_user, "the count must be taken as the fleet role").toBe("bms_fleet");
      const present = await run(
        `SELECT code FROM bms.calc_parameter_keys WHERE code = ANY($1::varchar[]) AND active ORDER BY sort_order, code`,
        [STOCK_KEYS],
      );
      expect(present.rows.map((r) => r.code).sort()).toEqual([...STOCK_KEYS].sort());
      expect(present.rows.length).toBe(12);
      // The SET ROLE bms_owner bracket is what makes 0041's default privileges
      // fire (no hand GRANT is written). U5's resolver is a FLEET read of the
      // store and the tenant pool writes it, so gate the effect, not the claim.
      const priv = await run(
        `SELECT has_table_privilege('bms_fleet',  'bms.calc_parameters', 'SELECT')      AS fleet_select,
                has_table_privilege('bms_tenant', 'bms.calc_parameters', 'INSERT')      AS tenant_insert,
                has_table_privilege('bms_tenant', 'bms.calc_parameters', 'UPDATE')      AS tenant_update,
                has_table_privilege('bms_tenant', 'bms.calc_parameters', 'DELETE')      AS tenant_delete,
                has_table_privilege('bms_tenant', 'bms.calc_parameter_keys', 'SELECT')  AS tenant_keys`,
      );
      expect(priv.rows[0]).toEqual({
        fleet_select: true,
        tenant_insert: true,
        tenant_update: true,
        tenant_delete: true,
        tenant_keys: true,
      });
      // Positive control for the charset check on the global table.
      await refuses(
        run,
        `INSERT INTO bms.calc_parameter_keys (code, label) VALUES ($1, 'bad')`,
        [`Bad-Key-${RUN}`],
        "23514",
        "calc_parameter_keys_code_charset_check",
      );
    } finally {
      await client.query("ROLLBACK");
    }
  });

  // I6
  it("refuses a parameter whose key is not in the vocabulary", async () => {
    await inTx(async (run) => {
      await refuses(
        run,
        INSERT,
        [orgA, `e41a_unknown_${RUN}`, null, null, 1, T0, null],
        "23503",
        "calc_parameters_key_fkey",
      );
    });
  });

  // I7 — the owed guard, as bms_tenant.
  it("as bms_tenant, sees only its own rows and cannot stamp another organization's asset or organization", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await client.query(`SET LOCAL app.current_organization = '${orgA}'`);
      const key = await mintKey(run, "i7");
      const assetA = await seedAsset(run, orgA, `I7A-${RUN}`);
      await accepts(run, INSERT, [orgA, key, null, null, 1, T0, T1], "org A's row as owner");
      await client.query(`SET LOCAL app.current_organization = '${orgB}'`);
      const assetB = await seedAsset(run, orgB, `I7B-${RUN}`);
      // Read org B's location here, under GUC B: bms.assets is policied, so it
      // is invisible once the role and GUC below are A's.
      const locationB = (await run(`SELECT location_id FROM bms.assets WHERE id = $1`, [assetB]))
        .rows[0]?.location_id as string;
      expect(locationB).toBeTruthy();
      await accepts(run, INSERT, [orgB, key, null, null, 2, T0, T1], "org B's row as owner");

      await client.query("SET LOCAL ROLE bms_tenant");
      await client.query(`SET LOCAL app.current_organization = '${orgA}'`);
      const who = await run(`SELECT current_user`);
      expect(who.rows[0]?.current_user).toBe("bms_tenant");

      // Positive control: exactly A's row is visible, B's is not.
      const seen = await run(`SELECT organization_id FROM bms.calc_parameters WHERE key = $1`, [key]);
      expect(seen.rows.length, "bms_tenant under GUC A sees exactly one row").toBe(1);
      expect(seen.rows[0]?.organization_id).toBe(orgA);

      // An own-organization write must succeed under bms_tenant before the
      // refusals prove anything — the asset leg passes for an own asset.
      await accepts(run, INSERT, [orgA, key, null, assetA, 3, T0, T1], "own-org, own-asset write under bms_tenant");

      // Org A stamped with org B's asset: the FK passes (RI runs with row
      // security OFF); only the policy's asset leg refuses it.
      await refuses(run, INSERT, [orgA, key, null, assetB, 4, T2, T3], "42501");
      // The same for the location leg: org A stamped with org B's location.
      await refuses(run, INSERT, [orgA, key, locationB, null, 5, T2, T3], "42501");
      // A row for org B under GUC A: the organization leg refuses it.
      await refuses(run, INSERT, [orgB, key, null, null, 5, T2, T3], "42501");
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
