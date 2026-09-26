import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.157` / ADR 0077 decisions 1-4 — what migration `0085` guarantees against
 * a real database (plan U1, I1-I6). `tests/f4.157-location-types-schema.test.ts`
 * asserts the migration's *text*; this asserts what Postgres enforces,
 * following `tests/f3.67-site-control-room-views-schema.integration.test.ts`'s
 * lifecycle: one held superuser client, `SET LOCAL ROLE` where a case needs a
 * narrower privilege, everything rolled back so nothing here commits — except
 * I5, which is a seeded-state read with no rollback needed.
 *
 * **I5 is the re-seed gate.** The PHE seed's UPDATE branch re-writes
 * `bms.locations.type` on every run, so a seed that still wrote `rsmoc` would
 * move the rows back after the migration. I5 reads only the rows the PHE seed
 * owns (`meta ? 'phe'`), not every PHEWB location: other suites create
 * PHEWB fixture locations of other valid types while this file runs against the
 * same database, and those rows are not the seed's claim.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.157",
  label: "bms.location_types schema tests",
  because:
    "the foreign key, the bms_tenant/bms_fleet grants and the PHEWB data move are all " +
    "things Postgres enforces, so a green run without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F4.157 — bms.location_types against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgId = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.157",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id FROM bms.organizations ORDER BY code LIMIT 1`);
    orgId = orgs.rows[0]?.id as string;
    if (!orgId) throw new Error("F4.157: needs at least one bms.organizations row — run pnpm db:seed.");
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /** Runs `body` inside a rolled-back transaction, as the superuser. */
  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** Runs `sql` under a SAVEPOINT and returns the error it raised (empty if none). */
  const probe = async (
    run: Run,
    sql: string,
    params: unknown[],
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

  // I1
  it("I1 the four rows exist, active, ordered 10/20/30/40 by sort_order", async () => {
    await inTx(async (run) => {
      const rows = await run(
        `SELECT code, label, sort_order, active FROM bms.location_types ORDER BY sort_order`,
      );
      expect(rows.rows.map((r) => [r.code, r.sort_order, r.active])).toEqual([
        ["smoc_campus", 10, true],
        ["rsmoc", 20, true],
        ["csmoc", 30, true],
        ["pump_station", 40, true],
      ]);
    });
  });

  // I2
  it("I2 a location with an unknown type fails 23503, naming locations_type_fk", async () => {
    await inTx(async (run) => {
      const slug = `f4157-${RUN}-i2`.toLowerCase();
      const { code, message } = await probe(
        run,
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, $4, 'not_a_type', 0, 0)`,
        [orgId, `F4157-${RUN}-I2`, slug, "F4.157 I2"],
      );
      expect(code, "expected a foreign-key violation, 23503").toBe("23503");
      expect(message, "expected the refusal to name locations_type_fk").toContain(
        "locations_type_fk",
      );
    });
  });

  // I3
  it("I3 as bms_tenant, SELECT succeeds and returns four rows", async () => {
    await inTx(async (run) => {
      await run("SET LOCAL ROLE bms_tenant");
      const rows = await run(`SELECT code FROM bms.location_types`);
      expect(rows.rows.length).toBe(4);
    });
  });

  it("I3 as bms_tenant, INSERT on bms.location_types fails 42501", async () => {
    await inTx(async (run) => {
      await run("SET LOCAL ROLE bms_tenant");
      const { code } = await probe(
        run,
        `INSERT INTO bms.location_types (code, label) VALUES ($1, $2)`,
        [`f4157-${RUN}`, "F4.157"],
      );
      expect(code).toBe("42501");
    });
  });

  it("I3 as bms_tenant, UPDATE on bms.location_types fails 42501", async () => {
    await inTx(async (run) => {
      await run("SET LOCAL ROLE bms_tenant");
      const { code } = await probe(
        run,
        `UPDATE bms.location_types SET label = $1 WHERE code = 'rsmoc'`,
        ["RSMOC"],
      );
      expect(code).toBe("42501");
    });
  });

  it("I3 as bms_tenant, DELETE on bms.location_types fails 42501", async () => {
    await inTx(async (run) => {
      await run("SET LOCAL ROLE bms_tenant");
      const { code } = await probe(run, `DELETE FROM bms.location_types WHERE code = 'rsmoc'`, []);
      expect(code).toBe("42501");
    });
  });

  // I4
  it("I4 as bms_fleet, SELECT succeeds — the map pool's precondition", async () => {
    await inTx(async (run) => {
      await run("SET LOCAL ROLE bms_fleet");
      const rows = await run(`SELECT code FROM bms.location_types`);
      expect(rows.rows.length).toBe(4);
    });
  });

  // I5 — see the module docblock.
  it("I5 every seeded PHE location and its map pin carry type/kind pump_station", async () => {
    await inTx(async (run) => {
      await run("SET LOCAL ROLE bms_fleet");
      const locationRows = await run(
        `SELECT l.type FROM bms.locations l
           JOIN bms.organizations o ON o.id = l.organization_id
          WHERE o.code = 'PHEWB' AND l.meta ? 'phe'`,
      );
      expect(locationRows.rows.length, "no PHEWB locations found — run pnpm db:seed").toBeGreaterThan(0);
      expect(new Set(locationRows.rows.map((r) => r.type))).toEqual(new Set(["pump_station"]));

      const mapRows = await run(
        `SELECT ml.kind FROM bms.map_locations ml
           JOIN bms.locations l ON l.slug = ml.slug
           JOIN bms.organizations o ON o.id = l.organization_id
          WHERE o.code = 'PHEWB' AND l.meta ? 'phe'`,
      );
      expect(mapRows.rows.length, "no PHEWB map pins found — run pnpm db:seed").toBeGreaterThan(0);
      expect(new Set(mapRows.rows.map((r) => r.kind))).toEqual(new Set(["pump_station"]));
    });
  });

  // I6
  it("I6 no bms.locations row has a type without a bms.location_types row", async () => {
    await inTx(async (run) => {
      await run("SET LOCAL ROLE bms_fleet");
      const orphans = await run(
        `SELECT count(*)::int AS n FROM bms.locations l
          WHERE NOT EXISTS (SELECT 1 FROM bms.location_types lt WHERE lt.code = l.type)`,
      );
      expect(orphans.rows[0]?.n).toBe(0);
    });
  });
});
