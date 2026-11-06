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
 * `F4.319` / ADR 0113 decisions 3 and 4 — what migration `0127` does against a real database.
 * The static half is `f4.319-pump-station-roles-schema.test.ts`.
 *
 * Superuser pool, one held client, every case inside `BEGIN` ... `ROLLBACK`. Nothing commits. The
 * cases use the seeded PHEWB memberships (`pnpm db:seed` loads the PHE catalog), set each role to
 * the state under test, run the whole migration body again, and read the result. Running the body
 * again is the re-run case too: the INSERT and the DO block must pass on a database that holds
 * both codes.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.319",
  label: "migration 0127 pump-station role tests",
  because:
    "the membership move is an UPDATE ... FROM that Postgres runs against FORCE-RLS rows, so a " +
    "green run without a database asserts nothing about which members it moves.",
});

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION_BODY = readFileSync(join(repoRoot, "packages/db/drizzle/0127_pump_station_roles.sql"), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>>; rowCount?: number | null };
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

/** One membership: its group and asset ids, and the asset code for a message. */
type Member = { groupId: string; assetId: string; code: string };

describe.skipIf(!has)("F4.319 — migration 0127 moves the PHE memberships to the new roles", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.319",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const inTx = async (body: () => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await body();
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const members = async (prefix: string, count: number, groupCode: string): Promise<Member[]> => {
    const res = await client.query(
      `SELECT agm.asset_group_id AS "groupId", agm.asset_id AS "assetId", a.code
         FROM bms.asset_group_members agm
         JOIN bms.assets a ON a.id = agm.asset_id
         JOIN bms.asset_groups ag ON ag.id = agm.asset_group_id
        WHERE a.code LIKE $1 AND ag.code = $3
        ORDER BY a.code, agm.asset_group_id
        LIMIT $2`,
      [`${prefix}%`, count, groupCode],
    );
    const rows = res.rows as unknown as Member[];
    if (rows.length < count) {
      throw new Error(`F4.319: needs ${count} seeded ${prefix} memberships, found ${rows.length} — run pnpm db:seed.`);
    }
    return rows;
  };

  const setRole = async (member: Member, role: string | null): Promise<void> => {
    await client.query(`UPDATE bms.asset_group_members SET role = $3 WHERE asset_group_id = $1 AND asset_id = $2`, [
      member.groupId,
      member.assetId,
      role,
    ]);
  };

  const roleOf = async (member: Member): Promise<unknown> =>
    (
      await client.query(`SELECT role FROM bms.asset_group_members WHERE asset_group_id = $1 AND asset_id = $2`, [
        member.groupId,
        member.assetId,
      ])
    ).rows[0]?.role;

  it("seeds both codes, active, in the Electrical band", async () => {
    const res = await client.query(
      `SELECT code, sort_order, active FROM bms.asset_roles WHERE code IN ('dosing-pump', 'rtu-controller') ORDER BY code`,
    );
    expect(res.rows).toEqual([
      { code: "dosing-pump", sort_order: 195, active: true },
      { code: "rtu-controller", sort_order: 200, active: true },
    ]);
  });

  it("moves a chlorine pump still at `pump`, and keeps a role an administrator set", async () => {
    await inTx(async () => {
      const [seeded, edited] = await members("PHE-PUMP-C-", 2, "electrical");
      await setRole(seeded!, "pump");
      await setRole(edited!, "mcc");
      await client.query(MIGRATION_BODY);
      expect(await roleOf(seeded!), seeded!.code).toBe("dosing-pump");
      expect(await roleOf(edited!), edited!.code).toBe("mcc");
    });
  });

  it("leaves a chlorine pump in another group alone (the seeded electrical group only)", async () => {
    await inTx(async () => {
      const [outside] = await members("PHE-PUMP-C-", 1, "pump-station");
      await setRole(outside!, "pump");
      await client.query(MIGRATION_BODY);
      expect(await roleOf(outside!), outside!.code).toBe("pump");
    });
  });

  it("leaves a main pump at `pump`", async () => {
    await inTx(async () => {
      const [main] = await members("PHE-PUMP-M-", 1, "electrical");
      await setRole(main!, "pump");
      await client.query(MIGRATION_BODY);
      expect(await roleOf(main!), main!.code).toBe("pump");
    });
  });

  it("gives an unroled RTU-health unit `rtu-controller`, and keeps a role an administrator set", async () => {
    await inTx(async () => {
      const [unroled, edited] = await members("PHE-AIRSP1051M-", 2, "environment");
      await setRole(unroled!, null);
      await setRole(edited!, "indoor-air");
      await client.query(MIGRATION_BODY);
      expect(await roleOf(unroled!), unroled!.code).toBe("rtu-controller");
      expect(await roleOf(edited!), edited!.code).toBe("indoor-air");
    });
  });
});
