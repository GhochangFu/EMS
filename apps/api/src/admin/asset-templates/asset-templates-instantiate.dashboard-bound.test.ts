import { describe, it } from "vitest";

import {
  assertABatchInsideTheBoundIsNotRefused,
  assertTheDashboardTermRefusesAnOverLargeBatch,
  assertTheOverLargeBatchWroteNothing,
} from "./asset-templates-instantiate.dashboard-bound.spec";

/**
 * `F3.2` / ADR 0067 decision 4, guard G3 — Vitest entry point. Assertions live
 * in the sibling `.spec` (§4.6 / ADR 0014). No database: the refusal happens
 * before the transaction opens, and an owed guard that skips without
 * `DATABASE_URL` is not a guard.
 *
 * One claim per `it()`: `expect` throws, so grouping them would leave every
 * assertion after the first unreached on a failure.
 */
describe("F3.2 — the instantiate hook passes the dashboard term to assertBatchFits", () => {
  it("refuses 200 assets x two 50-key featured views by name", async () => {
    await assertTheDashboardTermRefusesAnOverLargeBatch();
  });

  it("attempts no write when it refuses", async () => {
    await assertTheOverLargeBatchWroteNothing();
  });

  it("does not refuse a batch inside the bound", async () => {
    await assertABatchInsideTheBoundIsNotRefused();
  });
});
