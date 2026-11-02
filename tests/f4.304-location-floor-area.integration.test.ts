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
 * `F4.304` / ADR 0108 Amendment 5 item 1 — what migration `0121` guarantees against a real
 * database. `tests/f4.304-location-floor-area.test.ts` asserts the text; this asserts what Postgres
 * enforces. Superuser pool, one held client, every case in `BEGIN … ROLLBACK`, the role reached by
 * `SET LOCAL ROLE`, so nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.304",
  label: "location floor area tests",
  because:
    "the CHECK constraint, the numeric(12,2) scale and FORCE row level security are all " +
    "things Postgres enforces, so a green run without a database asserts nothing about any of them.",
});

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION_SQL = readFileSync(join(repoRoot, "packages/db/drizzle/0121_location_floor_area.sql"), "utf8");
const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type Rows = { rows: Array<Record<string, unknown>>; rowCount: number | null };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F4.304 — location floor area against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let eskom = "";
  let phewb = "";
  let typeCode = "";
  let eskomLocation = "";
  let phewbLocation = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.304",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`);
    eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
    phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
    if (!eskom || !phewb) throw new Error("F4.304: needs the seeded ESKOM and PHEWB organizations — run pnpm db:seed.");
    const types = await client.query(`SELECT code FROM bms.location_types ORDER BY code LIMIT 1`);
    typeCode = types.rows[0]?.code as string;
    const e = await client.query(`SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`, [eskom]);
    const p = await client.query(`SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`, [phewb]);
    eskomLocation = e.rows[0]?.id as string;
    phewbLocation = p.rows[0]?.id as string;
    if (!typeCode || !eskomLocation || !phewbLocation) throw new Error("F4.304: needs seeded locations — run pnpm db:seed.");
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

  const INSERT = (suffix: string): string =>
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, floor_area_m2)
     VALUES ('${eskom}', 'F4304-${RUN}-${suffix}', 'f4304-${RUN}-${suffix}', 'F4.304 probe', '${typeCode}', 0, 0, $1)
     RETURNING floor_area_m2::text AS area`;

  it.each([
    ["zero", "0", "z"],
    ["negative", "-1", "n"],
    ["NaN", "NaN", "nan"],
  ])("refuses an area of %s with 23514", async (_label, value, suffix) => {
    await inTx("bms_owner", eskom, async (run) => {
      expect(await probe(run, INSERT(suffix), [value])).toEqual({
        code: "23514",
        constraint: "locations_floor_area_m2_check",
      });
    });
  });

  it("refuses Infinity with 22003 (numeric field overflow)", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      expect((await probe(run, INSERT("inf"), ["Infinity"])).code).toBe("22003");
    });
  });

  it("stores NULL as a row with no area", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const r = await run(INSERT("null"), [null]);
      expect(r.rows[0]?.area).toBeNull();
    });
  });

  it("stores 0.01 as a row", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const r = await run(INSERT("min"), ["0.01"]);
      expect(r.rows[0]?.area).toBe("0.01");
    });
  });

  it("rounds 92.90304 to two places: '92.90'", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const r = await run(INSERT("ft"), ["92.90304"]);
      expect(r.rows[0]?.area).toBe("92.90");
    });
  });

  it("a second run of the migration body leaves one constraint and one column", async () => {
    await client.query("BEGIN");
    try {
      await client.query(MIGRATION_SQL);
      const c = await client.query(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'bms.locations'::regclass AND conname = 'locations_floor_area_m2_check'`,
      );
      const col = await client.query(
        `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'bms' AND table_name = 'locations' AND column_name = 'floor_area_m2'`,
      );
      expect(c.rows[0]?.n).toBe(1);
      expect(col.rows[0]?.n).toBe(1);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("bms_tenant under ESKOM updates no row of PHEWB", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      const r = await run(`UPDATE bms.locations SET floor_area_m2 = 10 WHERE id = $1`, [phewbLocation]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("bms_tenant under ESKOM updates a row of ESKOM (adjacent positive)", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      const r = await run(`UPDATE bms.locations SET floor_area_m2 = 10 WHERE id = $1`, [eskomLocation]);
      expect(r.rowCount).toBe(1);
    });
  });
});
