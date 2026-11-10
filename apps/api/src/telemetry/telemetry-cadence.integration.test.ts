import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAssetWindowsReportTheWindow,
  assertFastDeviceKeepsTheFloor,
  assertSixtySecondDeviceFollowsItsInterval,
  assertTheCapBoundsTheWindow,
  assertTheCheckRefusesANonPositiveInterval,
  assertUnknownCadenceTakesTheFloor,
  inRolledBackCadenceTransaction,
} from "./telemetry-cadence.integration.spec";

/**
 * `F4.350` — Vitest entry point for the per-asset freshness window against a real database
 * (ADR 0075 Amendment 3). Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * pool, and every case runs in a transaction the spec rolls back. `max: 1`: one connection.
 */
const connectionString = requireIntegrationDb({
  item: "F4.350",
  label: "per-asset freshness window",
  because:
    "the window is `clamp(2.5 x the RTU's interval, 25 s, 900 s)` in SQL (the `live` and `asset_windows` CTEs), " +
    "so a green run without a database asserts nothing about it.",
});

describe.skipIf(!connectionString)("F4.350 — an asset is live inside its own RTU's window", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.350", { max: 1 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () =>
    inRolledBackCadenceTransaction(pool as pg.Pool, fn);

  it("a 60 s device is live at 55 s and 140 s and offline at 160 s", run(assertSixtySecondDeviceFollowsItsInterval), 60_000);

  it("a 2 s device keeps the 25 s floor: live at 20 s, offline at 30 s", run(assertFastDeviceKeepsTheFloor), 60_000);

  it("an RTU with no interval and no history takes the floor", run(assertUnknownCadenceTakesTheFloor), 60_000);

  it("the cap bounds the window at 900 s", run(assertTheCapBoundsTheWindow), 60_000);

  it("asset_windows reports 150, 25, 900 and the floor", run(assertAssetWindowsReportTheWindow), 60_000);

  it("the CHECK refuses a zero interval", run(assertTheCheckRefusesANonPositiveInterval), 60_000);
});
