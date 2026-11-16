import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";
import { mlAnomalyScores, mlForecasts, mlModelRuns } from "../packages/db/src/schema/ml-schema.js";

/**
 * `E1.4a` / ADR 0135 Amendment 3 ruling 2, R-a, R-b, S5 — what migration `0158`
 * (`bms_tenant` reads `ml.forecasts` and `ml.model_runs`) guarantees against a
 * real database, and that the `ml` Drizzle mirror matches the columns Postgres
 * holds (R16). `tests/e1.4a-ml-read-grant.test.ts` asserts the text. Plan
 * `docs/plans/e1.4-forecast-read-path.md` §5, T1.3.
 *
 * The `tests/e1.1-ml-schema.integration.test.ts` lifecycle: one held superuser
 * client, every case inside `BEGIN … ROLLBACK`, a role reached by
 * `SET LOCAL ROLE` plus the tenant GUC, a `SAVEPOINT`-protected probe per
 * refusal. Nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "E1.4a",
  label: "ml read grant tests",
  because:
    "the schema marker, the bms_tenant grant, the refusals on anomaly_scores and on every write, " +
    "and the row level security that scopes the new reader are all things Postgres enforces, so a " +
    "green run without a database asserts nothing about any of them.",
});

const has = connectionString !== undefined && connectionString !== "";

type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

const TABLES = ["model_runs", "forecasts", "anomaly_scores"] as const;
const HOUR = "2026-01-01T10:00:00Z";

/** A Drizzle column, read off the table object without importing `drizzle-orm` here. */
type MirrorColumn = { name: string; notNull: boolean; getSQLType: () => string };

const mirrorColumns = (table: object): MirrorColumn[] =>
  Object.values(table).filter(
    (value): value is MirrorColumn =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as MirrorColumn).getSQLType === "function" &&
      typeof (value as MirrorColumn).name === "string",
  );

const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Drizzle's `varchar(n)` is Postgres's `character varying(n)`; every other type here prints the same. */
const asPostgresType = (sqlType: string): string => sqlType.replace(/^varchar\(/, "character varying(");

describe.skipIf(!has)("E1.4a — the ml read grant against a live database", () => {
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
    if (!id) throw new Error(`E1.4a: needs a seeded bms.assets row for organization ${org} — run pnpm db:seed.`);
    return id;
  };

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "E1.4a",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`);
    eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
    phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
    if (!eskom || !phewb) throw new Error("E1.4a: needs the seeded ESKOM and PHEWB organizations — run pnpm db:seed.");
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

  /** Plants one succeeded run and one forecast row for `org`, as bms_fleet. */
  const plant = async (run: Run, org: string, asset: string): Promise<string> => {
    await as(run, "bms_fleet", null);
    const id = randomUUID();
    await run(
      `INSERT INTO ml.model_runs
         (id, organization_id, model_name, model_version, config_hash, started_at, finished_at, rows_written, status)
       VALUES ($1, $2, 'amazon/chronos-2', $3, $4, '2026-01-01T10:05:00Z', '2026-01-01T10:06:00Z', 1, 'succeeded')`,
      [id, org, "0".repeat(40), "a".repeat(64)],
    );
    await run(
      `INSERT INTO ml.forecasts (organization_id, asset_id, point_key, horizon_bucket, issued_at, p10, p50, p90, model_run_id)
       VALUES ($1, $2, 'e14a_kw', $3::timestamptz, '2026-01-01T10:05:00Z', 1, 2, 3, $4)`,
      [org, asset, HOUR, id],
    );
    return id;
  };

  it("the schema-version marker reads bms-ml-schema-version=2 as bms_tenant", async () => {
    await inTx(async (run) => {
      await as(run, "bms_tenant", eskom);
      const r = await run(`SELECT obj_description('ml'::regnamespace, 'pg_namespace') AS marker`);
      expect(r.rows[0]?.marker).toBe("bms-ml-schema-version=2");
    });
  });

  it("bms_tenant reads its own organization's runs and forecasts only, and none with the GUC unset", async () => {
    await inTx(async (run) => {
      const eskomRun = await plant(run, eskom, eskomAsset);
      const phewbRun = await plant(run, phewb, phewbAsset);
      const runIds = [eskomRun, phewbRun];
      const readRuns = `SELECT id FROM ml.model_runs WHERE id = ANY($1::uuid[]) ORDER BY id`;
      const readForecasts = `SELECT model_run_id FROM ml.forecasts WHERE model_run_id = ANY($1::uuid[])`;

      await as(run, "bms_tenant", eskom);
      expect((await run(readRuns, [runIds])).rows.map((r) => r.id)).toEqual([eskomRun]);
      expect((await run(readForecasts, [runIds])).rows.map((r) => r.model_run_id)).toEqual([eskomRun]);

      await as(run, "bms_tenant", phewb);
      expect((await run(readRuns, [runIds])).rows.map((r) => r.id)).toEqual([phewbRun]);
      expect((await run(readForecasts, [runIds])).rows.map((r) => r.model_run_id)).toEqual([phewbRun]);

      await as(run, "bms_tenant", null);
      expect((await run(readRuns, [runIds])).rows).toHaveLength(0);
      expect((await run(readForecasts, [runIds])).rows).toHaveLength(0);
    });
  });

  it("bms_tenant is refused anomaly_scores and every write on every ml table (42501)", async () => {
    await inTx(async (run) => {
      const runId = await plant(run, eskom, eskomAsset);
      await as(run, "bms_tenant", eskom);
      expect((await probe(run, `SELECT 1 FROM ml.anomaly_scores LIMIT 1`)).code).toBe("42501");
      expect(
        (await probe(run, `SELECT organization_id FROM ml.anomaly_scores LIMIT 1`)).code,
        "no column-level grant either",
      ).toBe("42501");
      expect(
        (
          await probe(
            run,
            `INSERT INTO ml.model_runs
               (id, organization_id, model_name, model_version, config_hash, started_at, finished_at, rows_written, status)
             VALUES ($1, $2, 'm', 'v', $3, now(), now(), 0, 'succeeded')`,
            [randomUUID(), eskom, "a".repeat(64)],
          )
        ).code,
      ).toBe("42501");
      expect(
        (
          await probe(
            run,
            `INSERT INTO ml.forecasts (organization_id, asset_id, point_key, horizon_bucket, issued_at, p10, p50, p90, model_run_id)
             VALUES ($1, $2, 'e14a_kw', '2026-01-01T11:00:00Z', '2026-01-01T10:05:00Z', 1, 2, 3, $3)`,
            [eskom, eskomAsset, runId],
          )
        ).code,
      ).toBe("42501");
      expect(
        (
          await probe(
            run,
            `INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, model_run_id)
             VALUES ($1, $2, $3::timestamptz, 'mad', 0.5, $4)`,
            [eskom, eskomAsset, HOUR, runId],
          )
        ).code,
      ).toBe("42501");
      for (const table of TABLES) {
        expect((await probe(run, `UPDATE ml.${table} SET organization_id = organization_id`)).code, table).toBe("42501");
        expect((await probe(run, `DELETE FROM ml.${table}`)).code, table).toBe("42501");
        expect((await probe(run, `TRUNCATE ml.${table}`)).code, table).toBe("42501");
      }
    });
  });

  it("bms_auth reads no ml table (42501)", async () => {
    await inTx(async (run) => {
      await as(run, "bms_auth", eskom);
      for (const table of TABLES) {
        expect((await probe(run, `SELECT 1 FROM ml.${table} LIMIT 1`)).code, table).toBe("42501");
      }
    });
  });

  it("bms_fleet still inserts a run and a forecast, and reads both organizations", async () => {
    await inTx(async (run) => {
      const eskomRun = await plant(run, eskom, eskomAsset);
      const phewbRun = await plant(run, phewb, phewbAsset);
      await as(run, "bms_fleet", null);
      const r = await run(`SELECT id FROM ml.model_runs WHERE id = ANY($1::uuid[])`, [[eskomRun, phewbRun]]);
      expect(r.rows).toHaveLength(2);
    });
  });

  it("the Drizzle mirror's columns equal the database's (name, type, nullability) for all three tables (R16)", async () => {
    // Positive control: the column reader finds every column of a known table.
    expect(mirrorColumns(mlModelRuns).map((c) => c.name)).toContain("error_text");
    expect(mirrorColumns(mlModelRuns)).toHaveLength(10);

    for (const [table, mirror] of [
      ["model_runs", mlModelRuns],
      ["forecasts", mlForecasts],
      ["anomaly_scores", mlAnomalyScores],
    ] as const) {
      const db = await client.query(
        `SELECT c.column_name, c.is_nullable, format_type(a.atttypid, a.atttypmod) AS type
           FROM information_schema.columns c
           JOIN pg_attribute a ON a.attrelid = ('ml.' || c.table_name)::regclass AND a.attname = c.column_name
          WHERE c.table_schema = 'ml' AND c.table_name = $1
          ORDER BY c.column_name`,
        [table],
      );
      const fromDb = db.rows.map((r) => ({
        name: r.column_name as string,
        type: r.type as string,
        notNull: r.is_nullable === "NO",
      })).sort(byName);
      const fromMirror = mirrorColumns(mirror)
        .map((c) => ({ name: c.name, type: asPostgresType(c.getSQLType()), notNull: c.notNull }))
        .sort(byName);
      expect(fromDb.length, table).toBeGreaterThan(5);
      expect(fromMirror, table).toEqual(fromDb);
    }
  });
});
