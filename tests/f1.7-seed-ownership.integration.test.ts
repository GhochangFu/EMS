import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

// Relative, not `@bms/db`: the workspace package is a dependency of `apps/*`,
// not of the repo root, so the bare specifier does not resolve from `tests/`.
import { createDb } from "../packages/db/src/client.js";
import { seedPheCatalog } from "../packages/db/src/phe-pilot-seed.js";
import {
  ENABLED_SET_VERSION,
  F1_7_ENABLED_RTU_CODES,
} from "../packages/db/src/ingest-enabled-set.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F1.7` — the seed asserts the enabled set once, then the operator owns it.
 *
 * **This exists because the unit test could not gate the thing that matters.**
 * A review of the first draft reverted the entire seed change verbatim — deleted
 * the `resolveIngestEnabled` import, deleted the read-before-upsert, restored
 * `ingest_enabled = edgeRtuId === catalog.pilotEdgeRtuId` — and **145 tests
 * still passed**. No API spec references `ingest_enabled`, and `packages/db` is
 * outside the coverage denominator (`vitest.config.ts` `include` reaches
 * `apps/*`), so neither the compiler, the tests, nor coverage noticed. The
 * reverted tree restores the exact defect the change closes.
 *
 * **A single seed pass cannot reach the branches worth testing.** CI runs
 * `db:migrate → db:seed` once against a fresh database, so every row takes
 * `existing === null → "seeded"`. The `adopted` and `operator` branches — the
 * entire point — are unreachable in one pass by construction. So this seeds,
 * mutates the database the way an operator would, and seeds **again**.
 *
 * Every case restores what it changed, and the suite re-seeds at the end, so a
 * developer's database is left as it was found.
 */

const connectionString = requireIntegrationDb({
  item: "F1.7",
  label: "seed ownership tests",
  because:
    "whether a second `pnpm db:seed` reverts an operator's `ingest_enabled` is a " +
    "database behaviour across two passes, so a green run without one asserts nothing.",
});

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** In the enabled set, so the seed would switch it ON if it still owned the column. */
const ENABLED_RTU = "861736076104923"; // Bhutnirghat I — the ADR 0007 pilot
/** Held out of the set, so the seed would switch it OFF if it still owned the column. */
const HELD_BACK_RTU = "861736076128245"; // Bhutnirghat II — clock -0:21:34 (F4.54)

let pool: pg.Pool | undefined;
let db: ReturnType<typeof createDb> | undefined;

type RtuState = {
  ingest_enabled: boolean;
  source_type: string;
  stamp: string | null;
  mqtt_assets: number;
};

async function readRtu(code: string): Promise<RtuState> {
  if (!pool) throw new Error("pool not initialised");
  const res = await pool.query<RtuState>(
    `SELECT r.ingest_enabled,
            r.source_type,
            r.meta->>'enabledSetVersion' AS stamp,
            (SELECT count(*)::int FROM bms.assets a
              WHERE a.rtu_id = r.id AND a.meta->>'telemetrySource' = 'mqtt') AS mqtt_assets
       FROM bms.rtus r WHERE r.rtu_code = $1`,
    [code],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error(`no bms.rtus row for rtu_code ${code}`);
  return row;
}

/** What the admin RTU screen does: write the column and nothing else. */
async function operatorSets(code: string, enabled: boolean): Promise<void> {
  if (!pool) throw new Error("pool not initialised");
  await pool.query(`UPDATE bms.rtus SET ingest_enabled = $2 WHERE rtu_code = $1`, [
    code,
    enabled,
  ]);
}

async function reseed(): Promise<void> {
  if (!db || !pool) throw new Error("pool not initialised");
  await seedPheCatalog(db, pool);
}

describe("F1.7 seed ownership across two passes", () => {
  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString);
    db = createDb(connectionString);
    // Clear the stamp first, so pass one *adopts* rather than deferring.
    //
    // Without this the suite is not hermetic, and the failure is subtle enough
    // to be worth naming: once a row is stamped, `ingest_enabled` belongs to
    // whoever set it last — that is the whole feature. So a database left by an
    // earlier run with a station switched off keeps it switched off, correctly,
    // and the fixtures below then assert against a fleet that is not the set.
    // Found exactly that way: a mutation run's cleanup re-seeded with mutated
    // code and pinned four RTUs off, and the next clean run failed on the
    // invariant case rather than on anything it had changed.
    await pool.query(
      `UPDATE bms.rtus SET meta = meta - 'enabledSetVersion' WHERE rtu_code ~ '^8[0-9]{14}$'`,
    );
    await reseed();
  }, 120_000);

  afterAll(async () => {
    // Leave the database as the seed would have left it, whatever the cases did.
    if (db && pool) await reseed();
    await pool?.end();
  }, 120_000);

  it("does not re-enable what an operator disabled", async () => {
    const before = await readRtu(ENABLED_RTU);
    assert(
      before.ingest_enabled,
      `${ENABLED_RTU} is in the enabled set, so the first pass must enable it`,
    );
    assert(
      before.stamp === ENABLED_SET_VERSION,
      `the first pass must stamp the row; expected "${ENABLED_SET_VERSION}", got "${before.stamp}"`,
    );

    await operatorSets(ENABLED_RTU, false);
    await reseed();

    const after = await readRtu(ENABLED_RTU);
    // The defect this whole change exists to close. Before it, the upsert
    // carried `ingest_enabled = EXCLUDED.ingest_enabled` and this came back true
    // — on every PR, because CI runs the seed.
    assert(
      !after.ingest_enabled,
      "the second seed must NOT re-enable an RTU the operator disabled",
    );
    // The invariant `apps/sim` depends on has to follow, or ingest and the
    // simulator both write the same points.
    assert(
      after.source_type === "catalog",
      `source_type must follow ingest_enabled to 'catalog', got "${after.source_type}"`,
    );
    assert(
      after.mqtt_assets === 0,
      `its assets must leave telemetrySource='mqtt', got ${after.mqtt_assets} still on mqtt`,
    );

    await operatorSets(ENABLED_RTU, true);
    await reseed();
  }, 120_000);

  it("does not disable what an operator enabled", async () => {
    const before = await readRtu(HELD_BACK_RTU);
    assert(
      !before.ingest_enabled,
      `${HELD_BACK_RTU} is held out of the set, so the first pass must leave it disabled`,
    );

    // The mirror, and it matters as much: a station held back for clock skew or
    // a dark meter may be repaired in the field, and the operator can see that
    // on the health endpoint before this repository knows about it.
    await operatorSets(HELD_BACK_RTU, true);
    await reseed();

    const after = await readRtu(HELD_BACK_RTU);
    assert(
      after.ingest_enabled,
      "the second seed must NOT disable an RTU the operator enabled",
    );
    assert(
      after.source_type === "mqtt",
      `source_type must follow ingest_enabled to 'mqtt', got "${after.source_type}"`,
    );
    assert(
      after.mqtt_assets > 0,
      "its assets must move to telemetrySource='mqtt' so the simulator stops writing them",
    );

    await operatorSets(HELD_BACK_RTU, false);
    await reseed();
  }, 120_000);

  it("adopts the set again once the stamp is gone", async () => {
    // Two things at once. It proves the adoption path still works on a database
    // that predates the stamp — without which a changed set would never reach an
    // already-seeded fleet — and it demonstrates `F4.56`'s hole from the other
    // side: `rtus.meta` is writable through the admin API, and the durability
    // asserted above lasts exactly as long as this key does.
    await operatorSets(ENABLED_RTU, false);
    if (!pool) throw new Error("pool not initialised");
    await pool.query(
      `UPDATE bms.rtus SET meta = meta - 'enabledSetVersion' WHERE rtu_code = $1`,
      [ENABLED_RTU],
    );

    await reseed();

    const after = await readRtu(ENABLED_RTU);
    assert(
      after.ingest_enabled,
      "an unstamped row must take the set again, or a changed set never reaches a seeded database",
    );
    assert(
      after.stamp === ENABLED_SET_VERSION,
      `re-adoption must re-stamp; expected "${ENABLED_SET_VERSION}", got "${after.stamp}"`,
    );
  }, 120_000);

  it("puts every catalog RTU on one side of the mqtt invariant", async () => {
    if (!pool) throw new Error("pool not initialised");
    // Not a restatement of the unit test: this asserts the database agrees with
    // the list, across all twelve rows, after four seed passes and three
    // operator mutations.
    const res = await pool.query<{ rtu_code: string; ingest_enabled: boolean; split: number }>(
      `SELECT r.rtu_code, r.ingest_enabled,
              (SELECT count(*)::int FROM bms.assets a
                WHERE a.rtu_id = r.id
                  AND (a.meta->>'telemetrySource' = 'mqtt') IS DISTINCT FROM r.ingest_enabled) AS split
         FROM bms.rtus r
        WHERE r.rtu_code ~ '^8[0-9]{14}$'
        ORDER BY r.rtu_code`,
    );
    assert(res.rows.length === 12, `expected the twelve PHE RTUs, got ${res.rows.length}`);

    const split = res.rows.filter((r) => r.split > 0);
    assert(
      split.length === 0,
      `an RTU must be 'mqtt' on both itself and its assets or on neither; split: ${split
        .map((r) => `${r.rtu_code}(${r.split})`)
        .join(" ")}`,
    );

    const enabled = res.rows.filter((r) => r.ingest_enabled).map((r) => r.rtu_code).sort();
    const expected = [...F1_7_ENABLED_RTU_CODES].sort();
    assert(
      enabled.join(",") === expected.join(","),
      `the database must hold exactly the enabled set.\n  expected: ${expected.join(" ")}\n  actual:   ${enabled.join(" ")}`,
    );
  }, 120_000);
});
