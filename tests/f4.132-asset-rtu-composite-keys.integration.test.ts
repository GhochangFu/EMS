import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";
import { asRole } from "../apps/api/src/testing/role-urls.js";

/**
 * `F4.132` / `F4.137` (ADR 0102, migration `0113`) — what the four keys hold
 * against a real database. `tests/f4.132-asset-rtu-composite-keys-migration.test.ts`
 * asserts the migration's text and the Drizzle mirrors; this asserts what
 * Postgres enforces:
 *
 *   - K2 `rtus_location_id_organization_id_fkey` — an RTU's organization is its location's.
 *   - K3 `assets_location_id_organization_id_fkey` — an asset's organization is its location's.
 *   - K4 `assets_rtu_id_location_id_fkey` (target K1 `rtus_id_location_key`) —
 *     a wired asset's RTU is at the asset's own location; MATCH SIMPLE skips `rtu_id IS NULL`.
 *
 * Each refusal is proved as `bms_tenant`, as `bms_owner` and as the superuser
 * (no GUC), because the RI check runs with row security
 * off: the key refuses whatever the caller can see.
 *
 * **Why the disagreement is in the location or the RTU, never the row's own
 * organization.** Under `bms_tenant` and `bms_owner` the GUC is `orgB` and every
 * inserted row is stamped `orgB`. A row stamped with another organization fails
 * the `tenant_isolation` WITH CHECK (42501) before any key is consulted, which
 * would prove nothing about the key. So the row points at `orgA`'s location or
 * at an RTU at `orgA`'s location — the shape of the F4.137 `bms_tenant` probe —
 * and each case asserts the constraint *name*, not only SQLSTATE 23503.
 *
 * Lifecycle follows `tests/f2.10-location-tree-schema.integration.test.ts`:
 * every case runs in a transaction that is rolled back, and a write that is
 * expected to fail runs under `SAVEPOINT probe`. Nothing commits. Discovery
 * reads seeded rows only (`ORDER BY created_at, code`, F4.53).
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.132/F4.137",
  label: "asset and RTU composite-key tests",
  because:
    "the three composite foreign keys are things Postgres enforces, so a green run " +
    "without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

const K2 = "rtus_location_id_organization_id_fkey";
const K3 = "assets_location_id_organization_id_fkey";
const K4 = "assets_rtu_id_location_id_fkey";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};
type PgFailure = { code: string | undefined; constraint: string | undefined; message: string };

const NO_ERROR: PgFailure = { code: undefined, constraint: undefined, message: "" };

const failureOf = (err: unknown): PgFailure => {
  const e = err as { code?: string; constraint?: string } | undefined;
  return {
    code: e?.code,
    constraint: e?.constraint,
    message: err instanceof Error ? err.message : String(err),
  };
};

/** Runs `body` under a SAVEPOINT and returns the error it raised (`NO_ERROR` if none). */
const probe = async (run: Run, body: (run: Run) => Promise<unknown>): Promise<PgFailure> => {
  await run("SAVEPOINT probe");
  let failure = NO_ERROR;
  try {
    await body(run);
  } catch (err) {
    failure = failureOf(err);
  }
  await run("ROLLBACK TO SAVEPOINT probe");
  return failure;
};

const expectRefusedBy = (failure: PgFailure, constraint: string): void => {
  expect(
    { code: failure.code, constraint: failure.constraint },
    failure.message || "the write succeeded",
  ).toEqual({ code: "23503", constraint });
};

const expectAccepted = (failure: PgFailure): void => {
  expect(failure, failure.message).toEqual(NO_ERROR);
};

describe.skipIf(!has)("F4.132/F4.137 — asset and RTU composite keys against a live database", () => {
  let tenantPool: IntegrationPool;
  let ownerPool: IntegrationPool;
  let superPool: IntegrationPool;
  let orgA = "";
  let orgB = "";
  let locA = "";
  let locB = "";
  let rtuA = "";
  let seq = 0;

  beforeAll(async () => {
    const url = connectionString as string;
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.132",
    );
    ownerPool = await openIntegrationPool(url, "F4.132");
    superPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(url, "superuser", process.env),
      "F4.132",
    );
    const orgs = await superPool.query<{ id: string }>(
      `SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 2`,
    );
    orgA = orgs.rows[0]?.id ?? "";
    orgB = orgs.rows[1]?.id ?? "";
    if (!orgA || !orgB) throw new Error("F4.132: needs two bms.organizations rows — run pnpm db:seed.");
    const oldestLocation = async (org: string): Promise<string> => {
      const r = await superPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true
          ORDER BY created_at, code LIMIT 1`,
        [org],
      );
      const id = r.rows[0]?.id;
      if (!id) throw new Error(`F4.132: organization ${org} has no active location — run pnpm db:seed.`);
      return id;
    };
    locA = await oldestLocation(orgA);
    locB = await oldestLocation(orgB);
    const rtu = await superPool.query<{ id: string }>(
      `SELECT id FROM bms.rtus WHERE location_id = $1 AND active = true
        ORDER BY created_at, code LIMIT 1`,
      [locA],
    );
    rtuA = rtu.rows[0]?.id ?? "";
    if (!rtuA) throw new Error(`F4.132: location ${locA} has no active RTU — run pnpm db:seed.`);
  });

  afterAll(async () => {
    await tenantPool?.end();
    await ownerPool?.end();
    await superPool?.end();
  });

  /** Runs `body` in a rolled-back transaction on `pool`, as `orgB`'s tenant when `tenant`. */
  const inTx = async (
    pool: IntegrationPool,
    tenant: boolean,
    body: (run: Run) => Promise<void>,
  ): Promise<void> => {
    const client = (await pool.connect()) as unknown as IntegrationClient;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      if (tenant) await client.query(`SELECT set_config('app.current_organization', $1, true)`, [orgB]);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  };

  const nextCode = (): string => {
    seq += 1;
    return `F4132_${RUN}_${seq}`;
  };

  const insertRtu = async (run: Run, org: string, location: string): Promise<string> => {
    const code = nextCode();
    const r = await run(
      `INSERT INTO bms.rtus (organization_id, location_id, code, display_name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [org, location, code, `F4.132 ${code}`],
    );
    return r.rows[0]?.id as string;
  };

  const insertAsset = async (
    run: Run,
    org: string,
    location: string,
    rtu: string | null,
  ): Promise<string> => {
    const code = nextCode();
    const r = await run(
      `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, rtu_id, domain)
       VALUES ($1, $2, $3, 'F4.132', $4, $5, 'electrical') RETURNING id`,
      [org, code, `F4.132 ${code}`, location, rtu],
    );
    return r.rows[0]?.id as string;
  };

  /** A root location in `org`, inserted inside the caller's transaction. */
  const insertLocation = async (run: Run, org: string): Promise<string> => {
    const code = `F4132-${RUN}-${(seq += 1)}`;
    const r = await run(
      `INSERT INTO bms.locations
         (organization_id, code, slug, name, type, latitude, longitude, parent_id, active)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, NULL, true)
       RETURNING id`,
      [org, code, code.toLowerCase(), `F4.132 ${code}`],
    );
    return r.rows[0]?.id as string;
  };

  const roles: Array<[string, () => IntegrationPool, boolean]> = [
    ["bms_tenant", () => tenantPool, true],
    ["bms_owner", () => ownerPool, true],
    ["superuser (no GUC)", () => superPool, false],
  ];

  describe.each(roles)("as %s", (_role, pool, tenant) => {
    const run = (body: (run: Run) => Promise<void>) => inTx(pool(), tenant, body);

    it("L1 an RTU stamped orgB at orgA's location is refused by rtus_location_id_organization_id_fkey", async () => {
      await run(async (q) => {
        expectRefusedBy(await probe(q, (p) => insertRtu(p, orgB, locA)), K2);
      });
    });

    it("L2 an unwired asset stamped orgB at orgA's location is refused by assets_location_id_organization_id_fkey", async () => {
      await run(async (q) => {
        expectRefusedBy(await probe(q, (p) => insertAsset(p, orgB, locA, null)), K3);
      });
    });

    it("L3 an asset at orgB's location wired to an RTU at orgA's location is refused by assets_rtu_id_location_id_fkey", async () => {
      await run(async (q) => {
        expectRefusedBy(await probe(q, (p) => insertAsset(p, orgB, locB, rtuA)), K4);
      });
    });

    it("L4a an RTU stamped orgB at orgB's location is accepted", async () => {
      await run(async (q) => {
        expectAccepted(await probe(q, (p) => insertRtu(p, orgB, locB)));
      });
    });

    it("L4b an unwired asset stamped orgB at orgB's location is accepted (MATCH SIMPLE skips rtu_id NULL)", async () => {
      await run(async (q) => {
        expectAccepted(await probe(q, (p) => insertAsset(p, orgB, locB, null)));
      });
    });

    it("L4c an asset at orgB's location wired to an RTU at that location is accepted", async () => {
      await run(async (q) => {
        const rtu = await insertRtu(q, orgB, locB);
        expectAccepted(await probe(q, (p) => insertAsset(p, orgB, locB, rtu)));
      });
    });
  });

  describe.each(roles.slice(1))("update side, as %s", (_role, pool, tenant) => {
    const run = (body: (run: Run) => Promise<void>) => inTx(pool(), tenant, body);

    it("L5a moving a consistent unwired asset to orgA's location is refused by assets_location_id_organization_id_fkey", async () => {
      await run(async (q) => {
        const asset = await insertAsset(q, orgB, locB, null);
        const failure = await probe(q, (p) =>
          p(`UPDATE bms.assets SET location_id = $1 WHERE id = $2`, [locA, asset]),
        );
        expectRefusedBy(failure, K3);
      });
    });

    it("L5b wiring an asset at orgB's location to an RTU at orgA's location is refused by assets_rtu_id_location_id_fkey", async () => {
      await run(async (q) => {
        const asset = await insertAsset(q, orgB, locB, null);
        const failure = await probe(q, (p) =>
          p(`UPDATE bms.assets SET rtu_id = $1 WHERE id = $2`, [rtuA, asset]),
        );
        expectRefusedBy(failure, K4);
      });
    });
  });

  describe("referenced side, as the superuser", () => {
    const run = (body: (run: Run) => Promise<void>) => inTx(superPool, false, body);

    it("L6a moving an RTU that has a wired asset to another location is refused by assets_rtu_id_location_id_fkey", async () => {
      await run(async (q) => {
        const rtuNew = await insertRtu(q, orgB, locB);
        await insertAsset(q, orgB, locB, rtuNew);
        const loc2 = await insertLocation(q, orgB);
        const failure = await probe(q, (p) =>
          p(`UPDATE bms.rtus SET location_id = $1 WHERE id = $2`, [loc2, rtuNew]),
        );
        expectRefusedBy(failure, K4);
      });
    });

    it("L6b moving a location that holds an RTU to another organization is refused by rtus_location_id_organization_id_fkey", async () => {
      await run(async (q) => {
        const rtuNew = await insertRtu(q, orgB, locB);
        const loc2 = await insertLocation(q, orgB);
        // Moving the unwired RTU first keeps the seeded locB untouched by the update below.
        await q(`UPDATE bms.rtus SET location_id = $1 WHERE id = $2`, [loc2, rtuNew]);
        const failure = await probe(q, (p) =>
          p(`UPDATE bms.locations SET organization_id = $1 WHERE id = $2`, [orgA, loc2]),
        );
        expectRefusedBy(failure, K2);
      });
    });
  });

  describe("catalog and live data, as the superuser", () => {
    it("C1 the unique and the three FKs exist on their tables, the FKs NO ACTION both ways", async () => {
      const r = await superPool.query<{
        conname: string;
        conrelid: string;
        contype: string;
        confrelid: string;
        confdeltype: string;
        confupdtype: string;
      }>(
        `SELECT conname, conrelid::regclass::text AS conrelid, contype,
                confrelid::regclass::text AS confrelid, confdeltype, confupdtype
           FROM pg_constraint
          WHERE conrelid IN ('bms.rtus'::regclass, 'bms.assets'::regclass)
            AND conname = ANY($1::text[])
          ORDER BY conname`,
        [["rtus_id_location_key", K2, K3, K4]],
      );
      expect(
        r.rows.map((c) => [c.conname, c.conrelid, c.contype, c.confrelid, c.confdeltype, c.confupdtype]),
      ).toEqual([
        [K3, "bms.assets", "f", "bms.locations", "a", "a"],
        [K4, "bms.assets", "f", "bms.rtus", "a", "a"],
        ["rtus_id_location_key", "bms.rtus", "u", "-", " ", " "],
        [K2, "bms.rtus", "f", "bms.locations", "a", "a"],
      ]);
    });
  });
});
