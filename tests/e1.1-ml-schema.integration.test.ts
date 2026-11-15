import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `E1.1` / ADR 0135 decisions 3 and 4, Amendment 2 — what migration `0157`
 * (`ml.model_runs`, `ml.forecasts`, `ml.anomaly_scores`) guarantees against a
 * real database. `tests/e1.1-ml-schema.test.ts` asserts the text; this asserts
 * what Postgres enforces. Plan `docs/plans/e1.1-ml-serving-foundation.md` §6,
 * T2.4.
 *
 * The `tests/f3.16-device-health-schema.integration.test.ts` lifecycle: one held
 * client, every case inside `BEGIN … ROLLBACK`, a role reached by
 * `SET LOCAL ROLE` plus the tenant GUC, and a `SAVEPOINT`-protected probe per
 * refusal. Nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "E1.1",
  label: "ml schema tests",
  because:
    "the composite tenant keys, the CHECKs, FORCE row level security and the insert-only grant " +
    "to bms_fleet are all things Postgres enforces, so a green run without a database asserts " +
    "nothing about any of them.",
});

const has = connectionString !== undefined && connectionString !== "";

type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

const HASH = "a".repeat(64);
const HOUR = "2026-01-01T10:00:00Z";

describe.skipIf(!has)("E1.1 — ml schema against a live database", () => {
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
    if (!id) throw new Error(`E1.1: needs a seeded bms.assets row for organization ${org} — run pnpm db:seed.`);
    return id;
  };

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "E1.1",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`);
    eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
    phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
    if (!eskom || !phewb) throw new Error("E1.1: needs the seeded ESKOM and PHEWB organizations — run pnpm db:seed.");
    eskomAsset = await firstAsset(eskom);
    phewbAsset = await firstAsset(phewb);
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const inTx = async (role: string | null, org: string | null, body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      if (role !== null) await client.query(`SET LOCAL ROLE ${role}`);
      if (org !== null) await client.query(`SET LOCAL app.current_organization = '${org}'`);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
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
      (id, organization_id, model_name, model_version, config_hash, started_at, finished_at, rows_written, status, error_text)
    VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10) RETURNING id`;

  /** A valid run row; `over` replaces any of its ten parameters. */
  const runParams = (org: string, over: Partial<Record<string, unknown>> = {}): unknown[] => {
    const v = {
      id: randomUUID(),
      org,
      name: "chronos-2",
      version: "rev-test",
      hash: HASH,
      started: "2026-01-01T10:05:00Z",
      finished: "2026-01-01T10:06:00Z",
      rows: 48,
      status: "succeeded",
      error: null,
      ...over,
    };
    return [v.id, v.org, v.name, v.version, v.hash, v.started, v.finished, v.rows, v.status, v.error];
  };

  const insertRun = async (run: Run, org: string): Promise<string> => {
    const r = await run(INSERT_RUN, runParams(org));
    return r.rows[0]?.id as string;
  };

  const INSERT_FORECAST = `INSERT INTO ml.forecasts
      (organization_id, asset_id, point_key, horizon_bucket, issued_at, p10, p50, p90, model_run_id)
    VALUES ($1, $2, 'kw', $3::timestamptz, $4::timestamptz, $5::float8, $6::float8, $7::float8, $8) RETURNING asset_id`;

  const forecast = (
    org: string,
    asset: string,
    runId: string,
    over: { bucket?: string; issued?: string; p10?: string; p50?: string; p90?: string } = {},
  ): unknown[] => [
    org,
    asset,
    over.bucket ?? HOUR,
    over.issued ?? "2026-01-01T09:05:00Z",
    over.p10 ?? "1",
    over.p50 ?? "2",
    over.p90 ?? "3",
    runId,
  ];

  const INSERT_SCORE = `INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, model_run_id)
    VALUES ($1, $2, $3::timestamptz, 'mad', $4::float8, $5) RETURNING asset_id`;

  it("FORCE row level security is on for all three tables", async () => {
    const r = await client.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'ml' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    expect(r.rows).toEqual([
      { relname: "anomaly_scores", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "forecasts", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "model_runs", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it("the schema-version marker reads back as bms_fleet", async () => {
    await inTx("bms_fleet", null, async (run) => {
      const r = await run(`SELECT obj_description('ml'::regnamespace, 'pg_namespace') AS marker`);
      expect(r.rows[0]?.marker).toBe("bms-ml-schema-version=1");
    });
  });

  it("bms_fleet inserts a run, a forecast and a score for each organization", async () => {
    await inTx("bms_fleet", null, async (run) => {
      for (const [org, asset] of [
        [eskom, eskomAsset],
        [phewb, phewbAsset],
      ] as const) {
        const runId = await insertRun(run, org);
        expect((await run(INSERT_FORECAST, forecast(org, asset, runId))).rows).toHaveLength(1);
        expect((await run(INSERT_SCORE, [org, asset, HOUR, 0.5, runId])).rows).toHaveLength(1);
      }
    });
  });

  it("a row stamped with another organization is refused by the composite keys (23503)", async () => {
    await inTx("bms_fleet", null, async (run) => {
      const eskomRun = await insertRun(run, eskom);
      const phewbRun = await insertRun(run, phewb);
      // ESKOM's asset, PHEWB's organization_id.
      expect((await probe(run, INSERT_FORECAST, forecast(phewb, eskomAsset, phewbRun))).code).toBe("23503");
      // ESKOM's asset and organization, PHEWB's run.
      expect((await probe(run, INSERT_FORECAST, forecast(eskom, eskomAsset, phewbRun))).code).toBe("23503");
      expect((await probe(run, INSERT_SCORE, [eskom, eskomAsset, HOUR, 0.5, phewbRun])).code).toBe("23503");
      expect((await probe(run, INSERT_FORECAST, forecast(eskom, eskomAsset, eskomRun))).code).toBeUndefined();
    });
  });

  it("bms_fleet can never UPDATE, DELETE or TRUNCATE (42501)", async () => {
    await inTx("bms_fleet", null, async (run) => {
      for (const table of ["model_runs", "forecasts", "anomaly_scores"]) {
        expect((await probe(run, `UPDATE ml.${table} SET organization_id = organization_id`)).code, table).toBe("42501");
        expect((await probe(run, `DELETE FROM ml.${table}`)).code, table).toBe("42501");
        expect((await probe(run, `TRUNCATE ml.${table}`)).code, table).toBe("42501");
      }
    });
  });

  it("bms_tenant and bms_auth cannot read any ml table (42501: no schema usage)", async () => {
    for (const role of ["bms_tenant", "bms_auth"]) {
      await inTx(role, eskom, async (run) => {
        for (const table of ["model_runs", "forecasts", "anomaly_scores"]) {
          expect((await probe(run, `SELECT 1 FROM ml.${table} LIMIT 1`)).code, `${role} ${table}`).toBe("42501");
        }
      });
    }
  });

  it("the policy binds the owner: own organization only, none with the setting empty, foreign stamp refused", async () => {
    await inTx("bms_fleet", null, async (run) => {
      const eskomRun = await insertRun(run, eskom);
      const phewbRun = await insertRun(run, phewb);
      await run(INSERT_FORECAST, forecast(eskom, eskomAsset, eskomRun));
      await run(INSERT_FORECAST, forecast(phewb, phewbAsset, phewbRun));

      await run("SET LOCAL ROLE bms_owner");
      await run(`SET LOCAL app.current_organization = '${eskom}'`);
      const runs = await run(`SELECT DISTINCT organization_id FROM ml.model_runs WHERE id IN ($1, $2)`, [eskomRun, phewbRun]);
      expect(runs.rows.map((r) => r.organization_id)).toEqual([eskom]);
      const rows = await run(`SELECT DISTINCT organization_id FROM ml.forecasts WHERE model_run_id IN ($1, $2)`, [
        eskomRun,
        phewbRun,
      ]);
      expect(rows.rows.map((r) => r.organization_id)).toEqual([eskom]);
      expect((await probe(run, INSERT_RUN, runParams(phewb))).code).toBe("42501");

      await run(`SET LOCAL app.current_organization = ''`);
      expect((await run(`SELECT 1 FROM ml.model_runs WHERE id IN ($1, $2)`, [eskomRun, phewbRun])).rows).toHaveLength(0);
    });
  });

  it("refuses every malformed run (23514)", async () => {
    await inTx("bms_fleet", null, async (run) => {
      for (const [label, over] of [
        ["unknown status", { status: "running" }],
        ["failed without error_text", { status: "failed", rows: 0, error: null }],
        ["failed with rows written", { status: "failed", rows: 3, error: "inference:RuntimeError" }],
        ["succeeded with error_text", { error: "inference:RuntimeError" }],
        ["config_hash not 64 hex", { hash: "XYZ" }],
        ["finished before started", { finished: "2026-01-01T10:00:00Z" }],
        ["negative rows_written", { rows: -1 }],
      ] as const) {
        expect((await probe(run, INSERT_RUN, runParams(eskom, over))).code, label).toBe("23514");
      }
      expect(
        (await probe(run, INSERT_RUN, runParams(eskom, { status: "failed", rows: 0, error: "inference:RuntimeError" }))).code,
        "a well-formed failed run",
      ).toBeUndefined();
    });
  });

  it("refuses NaN, infinities and crossed quantiles in every position (23514)", async () => {
    await inTx("bms_fleet", null, async (run) => {
      const runId = await insertRun(run, eskom);
      for (const [label, q] of [
        ["NaN p10", { p10: "NaN" }],
        ["NaN p50", { p50: "NaN" }],
        ["NaN p90", { p90: "NaN" }],
        ["+Infinity p90", { p90: "Infinity" }],
        ["-Infinity p10", { p10: "-Infinity" }],
        ["p10 > p50", { p10: "2.5" }],
        ["p50 > p90", { p50: "3.5" }],
      ] as const) {
        expect((await probe(run, INSERT_FORECAST, forecast(eskom, eskomAsset, runId, q))).code, label).toBe("23514");
      }
      expect((await probe(run, INSERT_FORECAST, forecast(eskom, eskomAsset, runId, { p10: "2", p50: "2", p90: "2" }))).code).toBeUndefined();
    });
  });

  it("accepts a whole UTC hour and refuses :30 UTC, even when the session runs in Asia/Kolkata (the 0150 case)", async () => {
    await inTx("bms_fleet", null, async (run) => {
      await run("SET LOCAL TIME ZONE 'Asia/Kolkata'");
      const runId = await insertRun(run, eskom);
      // 10:30Z is 16:00 IST: a whole hour in the session's zone, not in UTC.
      const half = "2026-01-01T10:30:00Z";
      expect((await probe(run, INSERT_FORECAST, forecast(eskom, eskomAsset, runId))).code).toBeUndefined();
      expect((await probe(run, INSERT_FORECAST, forecast(eskom, eskomAsset, runId, { bucket: half }))).code).toBe("23514");
      expect((await probe(run, INSERT_SCORE, [eskom, eskomAsset, HOUR, 0.5, runId])).code).toBeUndefined();
      expect((await probe(run, INSERT_SCORE, [eskom, eskomAsset, half, 0.5, runId])).code).toBe("23514");
    });
  });

  it("refuses a score outside 0..1 or NaN (23514)", async () => {
    await inTx("bms_fleet", null, async (run) => {
      const runId = await insertRun(run, eskom);
      for (const score of ["-0.01", "1.01", "NaN"]) {
        expect((await probe(run, INSERT_SCORE, [eskom, eskomAsset, HOUR, score, runId])).code, score).toBe("23514");
      }
    });
  });

  it("keys forecasts by issue time and scores by run: a duplicate collides, a re-run does not", async () => {
    await inTx("bms_fleet", null, async (run) => {
      const first = await insertRun(run, eskom);
      const second = await insertRun(run, eskom);
      await run(INSERT_FORECAST, forecast(eskom, eskomAsset, first));
      expect((await probe(run, INSERT_FORECAST, forecast(eskom, eskomAsset, second))).code).toBe("23505");
      expect(
        (await probe(run, INSERT_FORECAST, forecast(eskom, eskomAsset, second, { issued: "2026-01-01T10:05:00Z" }))).code,
      ).toBeUndefined();
      await run(INSERT_SCORE, [eskom, eskomAsset, HOUR, 0.4, first]);
      expect((await probe(run, INSERT_SCORE, [eskom, eskomAsset, HOUR, 0.6, second])).code).toBeUndefined();
      expect((await probe(run, INSERT_SCORE, [eskom, eskomAsset, HOUR, 0.6, first])).code).toBe("23505");
    });
  });

  it("both asset keys cascade on delete, and the run keys do not", async () => {
    const r = await client.query(
      `SELECT conname, confdeltype FROM pg_constraint
        WHERE conrelid IN ('ml.forecasts'::regclass, 'ml.anomaly_scores'::regclass) AND contype = 'f'
        ORDER BY conname`,
    );
    expect(r.rows).toEqual([
      { conname: "anomaly_scores_asset_id_organization_id_fkey", confdeltype: "c" },
      { conname: "anomaly_scores_model_run_id_organization_id_fkey", confdeltype: "a" },
      { conname: "forecasts_asset_id_organization_id_fkey", confdeltype: "c" },
      { conname: "forecasts_model_run_id_organization_id_fkey", confdeltype: "a" },
    ]);
  });
});
