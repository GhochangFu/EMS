import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-d — what migration `0160` (`bms_tenant`
 * reads `ml.anomaly_scores`) guarantees against a real database.
 * `tests/e1.2b-ml-anomaly-read-grant.test.ts` asserts the text. Plan
 * `docs/plans/e1.2-anomaly-detection.md` §7, T2.3.
 *
 * The `tests/e1.4a-ml-read-grant.integration.test.ts` lifecycle: one held
 * superuser client, every case inside `BEGIN … ROLLBACK`, a role reached by
 * `SET LOCAL ROLE` plus the tenant GUC, a `SAVEPOINT`-protected probe per
 * refusal. Nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "E1.2b",
  label: "ml anomaly read grant tests",
  because:
    "the schema marker, the bms_tenant SELECT on anomaly_scores, the refusal of every write and of " +
    "bms_auth, and the row level security that scopes the reader are all things Postgres enforces, so " +
    "a green run without a database asserts nothing about any of them.",
});

const has = connectionString !== undefined && connectionString !== "";

type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

const BUCKET = "2026-01-01T10:00:00Z";

describe.skipIf(!has)("E1.2b — the ml anomaly read grant against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let eskom = "";
  let phewb = "";
  let eskomAsset = "";
  let phewbAsset = "";

  /** The organization's oldest asset — the seeded row, not one a parallel suite just added (the F4.53 rule). */
  const firstAsset = async (org: string): Promise<string> => {
    const r = await client.query(
      `SELECT id FROM bms.assets WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      [org],
    );
    const id = r.rows[0]?.id as string | undefined;
    if (!id) throw new Error(`E1.2b: needs a seeded bms.assets row for organization ${org} — run pnpm db:seed.`);
    return id;
  };

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "E1.2b",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`);
    eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
    phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
    if (!eskom || !phewb) throw new Error("E1.2b: needs the seeded ESKOM and PHEWB organizations — run pnpm db:seed.");
    eskomAsset = await firstAsset(eskom);
    phewbAsset = await firstAsset(phewb);
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** Switch role and tenant GUC inside the open transaction; `null` org leaves the GUC empty. */
  const as = async (run: Run, role: string, org: string | null): Promise<void> => {
    await run("RESET ROLE");
    await run(`SET LOCAL app.current_organization = '${org ?? ""}'`);
    await run(`SET LOCAL ROLE ${role}`);
  };

  const probe = async (run: Run, sql: string, params: unknown[] = []): Promise<{ code: string | undefined; rows: number }> => {
    await run("SAVEPOINT probe");
    let code: string | undefined;
    let rows = 0;
    try {
      rows = (await run(sql, params)).rows.length;
    } catch (err) {
      code = (err as NodeJS.ErrnoException | undefined)?.code;
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    return { code, rows };
  };

  const INSERT_RUN = `INSERT INTO ml.model_runs
      (id, organization_id, model_name, model_version, config_hash, started_at, finished_at, rows_written, status)
    VALUES ($1, $2, 'bms-anomaly', $3, $4, '2026-01-01T10:05:00Z', '2026-01-01T10:06:00Z', 1, 'succeeded')`;
  const INSERT_SCORE = `INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, model_run_id)
    VALUES ($1, $2, $3::timestamptz, 'baseline_mad', 0.5, $4)`;

  /** Plants one succeeded run and one score row for `org`, as bms_fleet. */
  const plant = async (run: Run, org: string, asset: string): Promise<string> => {
    await as(run, "bms_fleet", null);
    const id = randomUUID();
    await run(INSERT_RUN, [id, org, "0".repeat(40), "a".repeat(64)]);
    await run(INSERT_SCORE, [org, asset, BUCKET, id]);
    return id;
  };

  it("the schema-version marker reads bms-ml-schema-version=3 as bms_tenant", async () => {
    await inTx(async (run) => {
      await as(run, "bms_tenant", eskom);
      const r = await run(`SELECT obj_description('ml'::regnamespace, 'pg_namespace') AS marker`);
      expect(r.rows[0]?.marker).toBe("bms-ml-schema-version=3");
    });
  });

  it("bms_tenant reads its own organization's scores only, none with the GUC unset, none of A's under B's", async () => {
    await inTx(async (run) => {
      const eskomRun = await plant(run, eskom, eskomAsset);
      const phewbRun = await plant(run, phewb, phewbAsset);
      const runIds = [eskomRun, phewbRun];
      const readScores = `SELECT model_run_id FROM ml.anomaly_scores WHERE model_run_id = ANY($1::uuid[])`;

      await as(run, "bms_tenant", eskom);
      expect((await run(readScores, [runIds])).rows.map((r) => r.model_run_id)).toEqual([eskomRun]);

      await as(run, "bms_tenant", phewb);
      expect((await run(readScores, [runIds])).rows.map((r) => r.model_run_id)).toEqual([phewbRun]);
      expect((await run(readScores, [[eskomRun]])).rows).toHaveLength(0);

      await as(run, "bms_tenant", null);
      expect((await run(readScores, [runIds])).rows).toHaveLength(0);
    });
  });

  it("bms_tenant INSERT, UPDATE, DELETE and TRUNCATE on ml.anomaly_scores are refused (42501)", async () => {
    await inTx(async (run) => {
      const runId = await plant(run, eskom, eskomAsset);
      await as(run, "bms_tenant", eskom);
      expect((await probe(run, INSERT_SCORE, [eskom, eskomAsset, "2026-01-01T11:00:00Z", runId])).code).toBe("42501");
      expect((await probe(run, `UPDATE ml.anomaly_scores SET score = 0`)).code).toBe("42501");
      expect((await probe(run, `DELETE FROM ml.anomaly_scores`)).code).toBe("42501");
      expect((await probe(run, `TRUNCATE ml.anomaly_scores`)).code).toBe("42501");
    });
  });

  it("bms_auth SELECT on ml.anomaly_scores is refused (42501)", async () => {
    await inTx(async (run) => {
      await as(run, "bms_auth", eskom);
      expect((await probe(run, `SELECT 1 FROM ml.anomaly_scores LIMIT 1`)).code).toBe("42501");
    });
  });

  it("bms_fleet still inserts a run and a score, and reads both organizations", async () => {
    await inTx(async (run) => {
      const eskomRun = await plant(run, eskom, eskomAsset);
      const phewbRun = await plant(run, phewb, phewbAsset);
      await as(run, "bms_fleet", null);
      const r = await run(`SELECT model_run_id FROM ml.anomaly_scores WHERE model_run_id = ANY($1::uuid[])`, [
        [eskomRun, phewbRun],
      ]);
      expect(r.rows).toHaveLength(2);
    });
  });
});
