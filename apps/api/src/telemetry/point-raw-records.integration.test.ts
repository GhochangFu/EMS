import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAnOutsiderOnTheSameKeyIsNotRead,
  assertAPageAtTheBoundHasNoCursor,
  assertNewestFirstWithDeviceTime,
  assertTheCursorPagesWithoutOverlapOrGap,
  assertTheNewestPageIsBoundedByNow,
  cleanup,
  setupFixtures,
  type Fixtures,
} from "./point-raw-records.integration.spec";

/**
 * `F4.297` — Vitest entry point for `pointRawRecords` against a real database.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F4.297",
  label: "raw records read tests",
  because:
    "the newest-first order, the before keyset cursor, the plus-one page bound and the " +
    "asset_id containment on telemetry.point_values are engine behaviour.",
});

describe.skipIf(!connectionString)("F4.297 — pointRawRecords against Postgres", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures | undefined;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F4.297");
    pool = created;
    fx = await setupFixtures(created);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool, fx).catch(() => undefined);
      await pool.end();
    }
  }, 60_000);

  it("answers newest first with the device time or null", async () => {
    await assertNewestFirstWithDeviceTime(pool as pg.Pool, fx as Fixtures);
  });

  it("pages with the before cursor without overlap or gap", async () => {
    await assertTheCursorPagesWithoutOverlapOrGap(pool as pg.Pool, fx as Fixtures);
  });

  it("gives no cursor to a page that ends at the last row", async () => {
    await assertAPageAtTheBoundHasNoCursor(pool as pg.Pool, fx as Fixtures);
  });

  it("keeps another asset's rows on the same key out of the page", async () => {
    await assertAnOutsiderOnTheSameKeyIsNotRead(pool as pg.Pool, fx as Fixtures);
  });

  it("bounds the newest page by the now it is given", async () => {
    await assertTheNewestPageIsBoundedByNow(pool as pg.Pool, fx as Fixtures);
  });
});
