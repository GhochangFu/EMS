import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { inRolledBackTransaction } from "./dashboard-freshness.integration.spec";
import {
  assertAnInactiveLocationIsNotSummed,
  assertAnOffOrganizationIsNotSummed,
  assertAnOldKwIsNotSummed,
  assertNoEnergyLocationIsNullNotZero,
  assertOnWithoutKwIsShownWithNull,
  assertTheGlobalScopeSumsShownLocationsOnly,
  assertThePriorSumsTheShownLocations,
  assertTheRibbonEqualsTheCards,
  assertTheScopeDecidesEnergyData,
  assertTheShownSiteIsSummed,
} from "./estate-energy.integration.spec";

/**
 * `F4.375` — Vitest entry point for the estate ribbon's energy summary against a real database.
 * Assertions live in the sibling `.spec` (ADR 0014, §4.6); every case rolls its own transaction
 * back. `max: 1`: one connection, the default `fleet` role, as `DashboardService` runs in
 * production.
 */
const connectionString = requireIntegrationDb({
  item: "F4.375",
  label: "estate ribbon energy summary",
  because:
    "which locations show energy (the 30-day window, the organization setting, active locations, the asset scope) " +
    "and the sum over them are SQL inside kpis(), so a green run without a database asserts nothing about them.",
});

describe.skipIf(!connectionString)("F4.375 — the estate ribbon sums shown locations only (ADR 0133 Amendment 2)", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.375", { max: 1 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () => inRolledBackTransaction(pool as pg.Pool, fn);

  it("E1 — a shown site's kw is summed and a temperature-only site adds nothing", run(assertTheShownSiteIsSummed), 60_000);
  it("E2 — a kw older than 30 days is not summed", run(assertAnOldKwIsNotSummed), 60_000);
  it("E3 — an off organization's fresh kw is not summed", run(assertAnOffOrganizationIsNotSummed), 60_000);
  it("E4 — no energy location in scope reads not shown and null, never 0", run(assertNoEnergyLocationIsNullNotZero), 60_000);
  it("E5 — an on organization with no kw reads shown and null", run(assertOnWithoutKwIsShownWithNull), 60_000);
  it("E6 — a kw asset outside the scope does not make energy shown", run(assertTheScopeDecidesEnergyData), 60_000);
  it("E7 — the global scope adds a shown site and not an off one", run(assertTheGlobalScopeSumsShownLocationsOnly), 60_000);
  it("E8 — a kw at an inactive location is not summed", run(assertAnInactiveLocationIsNotSummed), 60_000);
  it("E9 — the prior sums the locations shown now", run(assertThePriorSumsTheShownLocations), 60_000);
  it("E10 — the ribbon equals the sum of the cards", run(assertTheRibbonEqualsTheCards), 60_000);
});
