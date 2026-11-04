import { describe, it } from "vitest";

import {
  aBatchsBackfillStartsAfterTheCommit,
  aBatchWithBackfillDaysStartsOneRunPerPoint,
  aBatchWithoutBackfillDaysStartsNothing,
  anOverridePutWithBackfillDaysStartsOneRun,
  anOverridePutWithoutBackfillDaysStartsNothing,
  anOverridesBackfillStartsAfterTheCommit,
} from "./calc-point-backfill-wiring.spec";

/** `F4.311` PR 5 review — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). No database, no Redis. */
describe("F4.311 — backfillDays reaches the backfill from the override PUT and the batch", () => {
  it("starts one run on the saved row for an override PUT with backfillDays", () =>
    anOverridePutWithBackfillDaysStartsOneRun());
  it("starts the override's backfill after its commit", () => anOverridesBackfillStartsAfterTheCommit());
  it("starts nothing for an override PUT without backfillDays", () => anOverridePutWithoutBackfillDaysStartsNothing());
  it("starts one run per point for a batch with backfillDays", () => aBatchWithBackfillDaysStartsOneRunPerPoint());
  it("starts the batch's backfill after its commit", () => aBatchsBackfillStartsAfterTheCommit());
  it("starts nothing for a batch without backfillDays", () => aBatchWithoutBackfillDaysStartsNothing());
});
