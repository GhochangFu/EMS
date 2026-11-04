import { describe, it } from "vitest";

import {
  assertAV1StandaloneReadingAStandaloneSiblingIsRefused,
  assertTheBackfillsReadLeavesTheGaugeAlone,
  assertTheDefaultFreshReadStillSetsTheGauge,
  assertTheRefusalIsCountedAsV1ReferencesDerived,
  assertTheSiblingItReadsStillLoads,
} from "./calc-definitions.standalone.spec";

/** `F4.311` PR 1 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.311 — standalone points join the v1_references_derived backstop", () => {
  it("refuses a v1 standalone formula that reads a standalone sibling", async () => {
    await assertAV1StandaloneReadingAStandaloneSiblingIsRefused();
  });

  it("still loads the sibling it reads", async () => {
    await assertTheSiblingItReadsStillLoads();
  });

  it("counts the refusal as v1_references_derived", async () => {
    await assertTheRefusalIsCountedAsV1ReferencesDerived();
  });

  it("F4.311 PR 5 review — the backfill's fresh read leaves the active-formulas gauge alone", async () => {
    await assertTheBackfillsReadLeavesTheGaugeAlone();
  });

  it("F4.311 PR 5 review — the default fresh read still sets the gauge", async () => {
    await assertTheDefaultFreshReadStillSetsTheGauge();
  });
});
