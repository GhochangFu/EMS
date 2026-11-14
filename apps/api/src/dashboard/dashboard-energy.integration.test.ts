import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertAKwAssetOutsideTheScopeIsNotEnergyData,
  assertAnInactiveKwAssetIsNotEnergyData,
  assertAutoIsNeverOnTheWire,
  assertAutoWithFreshKwIsShown,
  assertOffHidesAFreshKw,
  assertOnWithoutKwIsNullNotZero,
  assertOnlyAHealthCardIsScored,
  assertOnlyTemperatureIsNotShown,
  assertTheLocationDashboardCarriesTheFields,
  assertTheThirtyDayWindow,
} from "./dashboard-energy.integration.spec";
import { inRolledBackTransaction } from "./dashboard-freshness.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F4.364` — Vitest entry point for the location summary's energy fields. Assertions live in the
 * sibling `.spec` (§4.6); every case rolls its own transaction back.
 */
const connectionString = requireIntegrationDb({
  item: "F4.364",
  label: "location summary energy-field integration tests",
  because:
    "whether a location has energy data (the 30-day window, active assets, the asset scope) is SQL " +
    "inside locationKpis, and a green run without a database asserts nothing about it.",
});

describe.skipIf(!connectionString)("F4.364 — the location summary's energy fields (ADR 0133)", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.364", { max: 1 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () => inRolledBackTransaction(pool, fn);

  it("G1 — auto with a fresh kw is shown as kW", run(assertAutoWithFreshKwIsShown), 60_000);
  it("G2 — a kw 31 days old is not energy data; 29 days old is", run(assertTheThirtyDayWindow), 60_000);
  it("G3 — only a temp_c sample is not energy data", run(assertOnlyTemperatureIsNotShown), 60_000);
  it("G4 — on with no kw reads totalKw null, not 0", run(assertOnWithoutKwIsNullNotZero), 60_000);
  it("G5 — off hides a fresh kw", run(assertOffHidesAFreshKw), 60_000);
  it("G6 — an inactive kw asset is not energy data", run(assertAnInactiveKwAssetIsNotEnergyData), 60_000);
  it("G7 — a kw asset outside the asset scope is not energy data", run(assertAKwAssetOutsideTheScopeIsNotEnergyData), 60_000);
  it("G8 — auto never reaches the wire", run(assertAutoIsNeverOnTheWire), 60_000);
  it("G9 — only a health card is scored (Q6)", run(assertOnlyAHealthCardIsScored), 60_000);
  it("G10 — locationDashboard carries the same fields", run(assertTheLocationDashboardCarriesTheFields), 60_000);
});
