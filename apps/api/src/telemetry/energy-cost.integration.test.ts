import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAFutureRowIsNotYetEffective,
  assertARowEffectiveAfterTheRangeEndIsNull,
  assertARowEndedBeforeTheRangeEndIsNull,
  assertARowStartedInsideTheRangeIsInScopeAtTheEnd,
  assertLocationRowWinsForItsAssetOnly,
  assertMixedCurrencyIsNull,
  assertNoTariffIsNullNotZero,
  assertOrganizationTariffPricesTheTotal,
  assertReportPricesTheTotal,
  cleanup,
  seedCostFixture,
  type CostFixture,
} from "./energy-cost.integration.spec";

/**
 * `E4.1c` U4 — Vitest entry point for both tariff reads. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the one database lifecycle
 * both halves share: the kW rows are committed and materialised once in
 * `beforeAll` (two files doing that in parallel workers would contend on the
 * refresh lock), and each case inserts and deletes its own tariff rows.
 */

const connectionString = requireIntegrationDb({
  item: "E4.1c",
  label: "energy-cost tariff-read tests",
  because:
    "the cost is the composition of the kWh total, the per-asset read with each asset's " +
    "organization currency, and the resolver's nearest-scope lookup at an instant — three " +
    "statements whose agreement, and whose answer for an absent row, a pure test cannot check.",
});

describe.skipIf(!connectionString)("E4.1c — the tariff is a parameter (ADR 0070 decision 7)", () => {
  let pool: pg.Pool | undefined;
  let fx: CostFixture;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "E4.1c");
    pool = created;
    await cleanup(created);
    fx = await seedCostFixture(created);
  }, 120_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool, fx);
      await pool.end();
    }
  }, 120_000);

  describe("DashboardService.energySummary — per-asset nearest scope, effective now", () => {
    it("D1 prices the total at the organization row and reports the tariff and the currency", async () => {
      if (!pool) throw new Error("pool required");
      await assertOrganizationTariffPricesTheTotal(pool, fx);
    }, 30_000);

    it("D2 answers null, never 0, with no tariff in scope — and the kWh total is untouched", async () => {
      if (!pool) throw new Error("pool required");
      await assertNoTariffIsNullNotZero(pool, fx);
    }, 30_000);

    it("D3 lets a location row win for its own asset only, and reports no single tariff", async () => {
      if (!pool) throw new Error("pool required");
      await assertLocationRowWinsForItsAssetOnly(pool, fx);
    }, 30_000);

    it("D4 answers null for every field when the scope spans two currencies", async () => {
      if (!pool) throw new Error("pool required");
      await assertMixedCurrencyIsNull(pool, fx);
    }, 30_000);

    it("D5 ignores a row effective only after now — the instant is the window's end", async () => {
      if (!pool) throw new Error("pool required");
      await assertAFutureRowIsNotYetEffective(pool, fx);
    }, 30_000);
  });

  describe("ReportsService.energyPreview — effective at the range's end instant, and the export", () => {
    it("R1 prices the total in the organization's currency, and the CSV carries both", async () => {
      if (!pool) throw new Error("pool required");
      await assertReportPricesTheTotal(pool, fx);
    }, 30_000);

    it("R2 answers null for a row ended before the range's end, and the CSV writes the dash", async () => {
      if (!pool) throw new Error("pool required");
      await assertARowEndedBeforeTheRangeEndIsNull(pool, fx);
    }, 30_000);

    it("R3 answers null for a row effective only after the range's end", async () => {
      if (!pool) throw new Error("pool required");
      await assertARowEffectiveAfterTheRangeEndIsNull(pool, fx);
    }, 30_000);

    it("R3′ resolves a row that starts inside the range — the instant is the end, not now", async () => {
      if (!pool) throw new Error("pool required");
      await assertARowStartedInsideTheRangeIsInScopeAtTheEnd(pool, fx);
    }, 30_000);
  });
});
