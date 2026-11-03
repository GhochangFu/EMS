import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.303` / ADR 0108 Amendment 6 item 7 — what migration `0122` guarantees against a real
 * database. `tests/f4.303-report-schedule-params.test.ts` asserts the text; this asserts what
 * Postgres enforces. Superuser pool, one held client, every case in `BEGIN … ROLLBACK`, the role
 * reached by `SET LOCAL ROLE`, so nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.303",
  label: "report schedule params tests",
  because:
    "the object CHECK and FORCE row level security are things Postgres enforces, so a green " +
    "run without a database asserts nothing about either.",
});

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION_SQL = readFileSync(join(repoRoot, "packages/db/drizzle/0122_report_schedule_params.sql"), "utf8");
const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type Rows = { rows: Array<Record<string, unknown>>; rowCount: number | null };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F4.303 — report schedule params against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let eskom = "";
  let phewb = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.303",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`);
    eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
    phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
    if (!eskom || !phewb) throw new Error("F4.303: needs the seeded ESKOM and PHEWB organizations — run pnpm db:seed.");
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
  ): Promise<{ code: string | undefined; constraint: string | undefined }> => {
    await run("SAVEPOINT probe");
    let code: string | undefined;
    let constraint: string | undefined;
    try {
      await run(sql, params);
    } catch (err) {
      const e = err as { code?: string; constraint?: string } | undefined;
      code = e?.code;
      constraint = e?.constraint;
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    return { code, constraint };
  };

  const INSERT = (org: string, suffix: string, literal: string): string =>
    `INSERT INTO bms.report_schedules
       (organization_id, name, template_id, formats, cadence, run_at_local, timezone, next_run_at, params)
     VALUES ('${org}', 'F4303-${RUN}-${suffix}', 'energy_consumption', ARRAY['pdf'], 'daily', '06:00', 'Asia/Kolkata', now(), ${literal})
     RETURNING id, params::text AS params`;

  it.each([
    ["an array", "'[]'::jsonb", "a"],
    ["a number", "'1'::jsonb", "n"],
    ["a string", "'\"x\"'::jsonb", "s"],
  ])("refuses params of %s with 23514", async (_label, literal, suffix) => {
    await inTx("bms_owner", eskom, async (run) => {
      expect(await probe(run, INSERT(eskom, suffix, literal))).toEqual({
        code: "23514",
        constraint: "report_schedules_params_object_check",
      });
    });
  });

  it("stores NULL params as a row", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const r = await run(INSERT(eskom, "null", "NULL"));
      expect(r.rows[0]?.params).toBeNull();
    });
  });

  it("stores an empty object as a row", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const r = await run(INSERT(eskom, "empty", "'{}'::jsonb"));
      expect(r.rows[0]?.params).toBe("{}");
    });
  });

  it("stores { compare: true } as a row", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const r = await run(INSERT(eskom, "cmp", `'{"compare":true}'::jsonb`));
      expect(r.rows[0]?.params).toBe('{"compare": true}');
    });
  });

  it("a second run of the migration body leaves one constraint and one column", async () => {
    await client.query("BEGIN");
    try {
      await client.query(MIGRATION_SQL);
      const c = await client.query(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'bms.report_schedules'::regclass AND conname = 'report_schedules_params_object_check'`,
      );
      const col = await client.query(
        `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'bms' AND table_name = 'report_schedules' AND column_name = 'params'`,
      );
      expect(c.rows[0]?.n).toBe(1);
      expect(col.rows[0]?.n).toBe(1);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("bms_tenant under ESKOM updates no schedule of PHEWB", async () => {
    await client.query("BEGIN");
    try {
      const inserted = await client.query(INSERT(phewb, "x", "NULL"));
      const id = inserted.rows[0]?.id as string;
      await client.query(`SET LOCAL ROLE bms_tenant`);
      await client.query(`SET LOCAL app.current_organization = '${eskom}'`);
      const r = await client.query(`UPDATE bms.report_schedules SET params = '{"compare":true}' WHERE id = $1`, [id]);
      expect(r.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("bms_tenant under ESKOM updates a schedule of ESKOM (adjacent positive)", async () => {
    await client.query("BEGIN");
    try {
      const inserted = await client.query(INSERT(eskom, "y", "NULL"));
      const id = inserted.rows[0]?.id as string;
      await client.query(`SET LOCAL ROLE bms_tenant`);
      await client.query(`SET LOCAL app.current_organization = '${eskom}'`);
      const r = await client.query(`UPDATE bms.report_schedules SET params = '{"compare":true}' WHERE id = $1`, [id]);
      expect(r.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
