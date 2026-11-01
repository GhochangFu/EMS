import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.300` / ADR 0108 decision 3 — what migration `0117` guarantees against a
 * real database. `tests/f4.300-trend-points-schema.test.ts` asserts the text;
 * this asserts what Postgres enforces. Superuser pool, one held client, every
 * case in `BEGIN … ROLLBACK`, the role reached by `SET LOCAL ROLE` (the
 * role-grants suite's way), so nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.300",
  label: "trend points schema tests",
  because:
    "the tenant trigger, the 0059 privilege revoke, FORCE row level security and the " +
    "foreign keys are all things Postgres enforces, so a green run without a database " +
    "asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F4.300 — trend points schema against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let eskom = "";
  let phewb = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.300",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(
      `SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`,
    );
    eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
    phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
    if (!eskom || !phewb) throw new Error("F4.300: needs the seeded ESKOM and PHEWB organizations — run pnpm db:seed.");
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const inTx = async (role: string, org: string, body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL ROLE ${role}`);
      await client.query(`SET LOCAL app.current_organization = '${org}'`);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const probe = async (
    run: Run,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ code: string | undefined; message: string }> => {
    await run("SAVEPOINT probe");
    let code: string | undefined;
    let message = "";
    try {
      await run(sql, params);
    } catch (err) {
      code = (err as NodeJS.ErrnoException | undefined)?.code;
      message = err instanceof Error ? err.message : String(err);
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    return { code, message };
  };

  const code = (suffix: string): string => `f4300-${RUN}-${suffix}`;
  const INSERT_KEY = `INSERT INTO bms.point_keys (code, name, trend_default) VALUES ($1, 'F4.300 probe', $2)`;

  it("FORCE row level security is on for org_trend_points", async () => {
    const r = await client.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'bms.org_trend_points'::regclass`,
    );
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("refuses bms_tenant a point key with trend_default = true, 42501 naming trend_default", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      const r = await probe(run, INSERT_KEY, [code("t"), true]);
      expect(r.code).toBe("42501");
      expect(r.message).toContain("trend_default");
    });
  });

  it("refuses bms_tenant a point key with trend_default = false too (tri-state: any decided value)", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      const r = await probe(run, INSERT_KEY, [code("f"), false]);
      expect(r.code).toBe("42501");
      expect(r.message).toContain("trend_default");
    });
  });

  it("lets bms_tenant insert a point key with trend_default NULL (adjacent positive)", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      const r = await probe(run, INSERT_KEY, [code("n"), null]);
      expect(r.code).toBeUndefined();
      expect(r.message).toBe("");
    });
  });

  it("refuses bms_tenant an UPDATE of trend_default by the 0059 revoke, not the trigger", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      const r = await probe(run, `UPDATE bms.point_keys SET trend_default = true WHERE code = $1`, [code("none")]);
      expect(r.code).toBe("42501");
      expect(r.message).toMatch(/permission denied/i);
      // The trigger's message names the column; the privilege system's does not.
      expect(r.message).not.toContain("trend_default");
    });
  });

  it.each(["bms_tenant", "bms_fleet"])("%s holds SELECT, INSERT, UPDATE and DELETE on org_trend_points", async (role) => {
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const r = await client.query(`SELECT has_table_privilege($1, 'bms.org_trend_points', $2) AS ok`, [role, priv]);
      expect(r.rows[0]?.ok, `${role} ${priv}`).toBe(true);
    }
  });

  it("a PHEWB row reads 0 rows as tenant ESKOM and 1 as tenant PHEWB", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await client.query(`SET LOCAL app.current_organization = '${phewb}'`);
      await client.query(
        `INSERT INTO bms.org_trend_points (organization_id, domain, point_key, sort_order)
         SELECT $1, 'electrical', code, 0 FROM bms.point_keys ORDER BY created_at, code LIMIT 1`,
        [phewb],
      );
      await client.query("RESET ROLE");

      await client.query("SET LOCAL ROLE bms_tenant");
      await client.query(`SET LOCAL app.current_organization = '${eskom}'`);
      const asEskom = await client.query(`SELECT count(*)::int AS n FROM bms.org_trend_points`);
      await client.query(`SET LOCAL app.current_organization = '${phewb}'`);
      const asPhewb = await client.query(`SELECT count(*)::int AS n FROM bms.org_trend_points`);
      expect(asEskom.rows[0]?.n).toBe(0);
      expect(asPhewb.rows[0]?.n).toBe(1);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("refuses a domain that is not an asset_domains code, 23503", async () => {
    await inTx("bms_owner", phewb, async (run) => {
      const r = await probe(
        run,
        `INSERT INTO bms.org_trend_points (organization_id, domain, point_key, sort_order)
         SELECT $1, 'no-such-segment', code, 0 FROM bms.point_keys ORDER BY created_at, code LIMIT 1`,
        [phewb],
      );
      expect(r.code).toBe("23503");
    });
  });

  it("refuses a point_key that is not in the catalog, 23503", async () => {
    await inTx("bms_owner", phewb, async (run) => {
      const r = await probe(
        run,
        `INSERT INTO bms.org_trend_points (organization_id, domain, point_key, sort_order)
         VALUES ($1, 'electrical', $2, 0)`,
        [phewb, code("missing")],
      );
      expect(r.code).toBe("23503");
    });
  });
});
