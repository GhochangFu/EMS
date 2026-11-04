import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.311` / ADR 0109 decision 7 — what migration `0123` guarantees against a
 * real database. `tests/f4.311-calc-backfill-runs-schema.test.ts` asserts the
 * text; this asserts what Postgres enforces. Superuser pool, one held client,
 * every case in `BEGIN … ROLLBACK`, the role reached by `SET LOCAL ROLE`, so
 * nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.311",
  label: "calc backfill runs schema tests",
  because:
    "FORCE row level security, the one-active-run partial unique index and the " +
    "ON DELETE CASCADE are things Postgres enforces, so a green run without a " +
    "database asserts nothing about any of them.",
});

const has = connectionString !== undefined && connectionString !== "";

type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F4.311 — calc backfill runs schema against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let eskom = "";
  let phewb = "";
  let pointId = "";
  let phewbPointId = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.311",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(
      `SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`,
    );
    eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
    phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
    if (!eskom || !phewb) throw new Error("F4.311: needs the seeded ESKOM and PHEWB organizations — run pnpm db:seed.");
    const pt = await client.query(
      `SELECT id FROM bms.asset_points WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      [eskom],
    );
    pointId = pt.rows[0]?.id as string;
    if (!pointId) throw new Error("F4.311: needs at least one ESKOM bms.asset_points row — run pnpm db:seed.");
    const other = await client.query(
      `SELECT id FROM bms.asset_points WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      [phewb],
    );
    phewbPointId = other.rows[0]?.id as string;
    if (!phewbPointId) throw new Error("F4.311: needs at least one PHEWB bms.asset_points row — run pnpm db:seed.");
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

  const INSERT_RUN = `INSERT INTO bms.calc_backfill_runs (organization_id, asset_point_id, from_at, to_at, status)
    VALUES ($1, $2, now() - interval '2 days', now() - interval '1 day', $3)`;

  it("FORCE row level security is on for calc_backfill_runs", async () => {
    const r = await client.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'bms.calc_backfill_runs'::regclass`,
    );
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("refuses bms_tenant an insert for another organization (WITH CHECK), 42501", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      const r = await probe(run, INSERT_RUN, [phewb, pointId, "queued"]);
      expect(r.code).toBe("42501");
    });
  });

  it("refuses bms_tenant a run on its own organization_id against another organization's point, 42501", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      const r = await probe(run, INSERT_RUN, [eskom, phewbPointId, "queued"]);
      expect(r.code).toBe("42501");
    });
  });

  it("lets bms_tenant insert a run for its own organization (adjacent positive)", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      const r = await probe(run, INSERT_RUN, [eskom, pointId, "queued"]);
      expect(r.code).toBeUndefined();
      expect(r.message).toBe("");
    });
  });

  it("refuses a second queued run for the same point, 23505", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      await run(INSERT_RUN, [eskom, pointId, "queued"]);
      const r = await probe(run, INSERT_RUN, [eskom, pointId, "queued"]);
      expect(r.code).toBe("23505");
      expect(r.message).toContain("calc_backfill_runs_one_active");
    });
  });

  it("accepts a new queued run after the earlier one is done", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      await run(INSERT_RUN, [eskom, pointId, "done"]);
      const r = await probe(run, INSERT_RUN, [eskom, pointId, "queued"]);
      expect(r.code).toBeUndefined();
      expect(r.message).toBe("");
    });
  });

  it("refuses a window longer than 31 days, 23514", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const r = await probe(
        run,
        `INSERT INTO bms.calc_backfill_runs (organization_id, asset_point_id, from_at, to_at)
         VALUES ($1, $2, now() - interval '40 days', now())`,
        [eskom, pointId],
      );
      expect(r.code).toBe("23514");
    });
  });

  it("deleting the asset_points row removes its runs (ON DELETE CASCADE)", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const suffix = randomUUID().slice(0, 8);
      // `asset_points.point_key` references `point_keys(code)` (migration 0057).
      await run(
        `INSERT INTO bms.point_keys (code, name, active) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
        [`f4311_${suffix}`, `F4.311 ${suffix}`],
      );
      const pt = await run(
        `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key)
         SELECT organization_id, asset_id, $2::text, $2::text FROM bms.asset_points WHERE id = $1
         RETURNING id`,
        [pointId, `f4311_${suffix}`],
      );
      const probeId = pt.rows[0]?.id as string;
      await run(INSERT_RUN, [eskom, probeId, "queued"]);
      await run(`DELETE FROM bms.asset_points WHERE id = $1`, [probeId]);
      const left = await run(
        `SELECT count(*)::int AS n FROM bms.calc_backfill_runs WHERE asset_point_id = $1`,
        [probeId],
      );
      expect(left.rows[0]?.n).toBe(0);
    });
  });
});
