import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Relative, not `@bms/db`: the workspace package is a dependency of `apps/*`,
// not of the repo root, so the bare specifier does not resolve from `tests/`.
import { seedPointKeyStates } from "../packages/db/src/point-key-states-seed.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.74` D1 — what `seedPointKeyStates` guarantees against a real Postgres.
 * Model: `tests/f3.68-point-key-headline-ranks-seed.integration.test.ts`.
 *
 * - **I1** after a full `pnpm db:seed` the table holds exactly the three rows D1 names.
 * - **I2** a second run changes nothing: same rows, same ids.
 * - **I3** a hand-edited label or tone is restored by the next run (`DO UPDATE`, not
 *   `DO NOTHING` — the rows are seed-owned).
 *
 * I2 and I3 run on one client inside `BEGIN` … `ROLLBACK`, so nothing they write survives.
 * Connection `"owner"`: the seed path runs as `bms_owner`, the table's owner, and the
 * `REVOKE` in `0097` is from `bms_tenant` only.
 */

const ownerUrl = requireIntegrationDb({
  item: "F3.74 D1",
  label: "the seeded point-key state map (bms.point_key_states)",
  because:
    "the exactly-three-rows claim, the idempotent re-run and the restore of a hand-edited label " +
    "are all things Postgres holds, so a green run without a database asserts nothing about any of them.",
  connection: "owner",
});

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = Parameters<typeof seedPointKeyStates>[0];

interface StateRow {
  id: string;
  point_key_code: string;
  value: number;
  label: string;
  tone: string;
}

const EXPECTED = [
  { point_key_code: "breaker_main", value: 0, label: "OPEN", tone: "open" },
  { point_key_code: "breaker_main", value: 1, label: "CLOSED", tone: "closed" },
  { point_key_code: "breaker_trip", value: 1, label: "TRIPPED", tone: "tripped" },
];

async function readRows(client: IntegrationClient): Promise<StateRow[]> {
  const { rows } = await client.query<StateRow>(
    `SELECT id, point_key_code, value, label, tone FROM bms.point_key_states ORDER BY point_key_code, value`,
  );
  return rows;
}

describe.skipIf(!ownerUrl)("F3.74 D1 — seedPointKeyStates", () => {
  let pool: IntegrationPool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(ownerUrl as string, "F3.74 D1");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  async function inRolledBackTransaction(fn: (client: IntegrationClient) => Promise<void>): Promise<void> {
    if (!pool) throw new Error("pool not initialised");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await fn(client);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  // I1
  it("holds exactly the three D1 rows after pnpm db:seed", async () => {
    if (!pool) throw new Error("pool not initialised");
    const rows = await readRows(pool);
    expect(rows.map(({ id: _id, ...rest }) => rest)).toEqual(EXPECTED);
  });

  // I2
  it("a second run changes nothing — same three rows, same ids", async () => {
    await inRolledBackTransaction(async (client) => {
      const before = await readRows(client);
      expect(before).toHaveLength(3);
      const count = await seedPointKeyStates(client);
      expect(count).toBe(3);
      expect(await readRows(client)).toEqual(before);
    });
  });

  // I3
  it("restores a hand-edited label and tone", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `UPDATE bms.point_key_states SET label = 'hand edited', tone = 'open'
          WHERE point_key_code = 'breaker_trip' AND value = 1`,
      );
      await seedPointKeyStates(client);
      const { rows } = await client.query<{ label: string; tone: string }>(
        `SELECT label, tone FROM bms.point_key_states WHERE point_key_code = 'breaker_trip' AND value = 1`,
      );
      expect(rows).toEqual([{ label: "TRIPPED", tone: "tripped" }]);
    });
  });
});
