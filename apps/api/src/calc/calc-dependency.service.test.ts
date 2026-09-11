import { describe, it } from "vitest";

import {
  assertACandidateOffEveryCycleReportsNothing,
  assertAValidationReadDoesNotConsumeTheRefreshWindow,
  assertTheBatchResolvesOnceForTheWholeBatch,
  assertTheCandidateReplacesItsOwnStoredNode,
  assertTheDetectorsReadDoesNotCountSkips,
  assertUnresolvedQualifiedCodesNamesOnlyTheNullEntries,
  assertUnresolvedQualifiedCodesReadsNothingWithoutAQualifiedReference,
} from "./calc-dependency.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.9 — CalcDependencyService, the save-time cycle detector", () => {
  it("resolves without counting a skip, and still sees the stored definitions", async () => {
    await assertTheDetectorsReadDoesNotCountSkips();
  });

  it("does not consume the sweep's refresh window: the next ensureFresh() still reloads and counts", async () => {
    await assertAValidationReadDoesNotConsumeTheRefreshWindow();
  });

  it("replaces the stored definition for the candidate's own key", async () => {
    await assertTheCandidateReplacesItsOwnStoredNode();
  });

  it("reports nothing for a candidate that only reads a cycle", async () => {
    await assertACandidateOffEveryCycleReportsNothing();
  });

  it("resolves the estate once for a whole batch, and still builds one graph per candidate", async () => {
    await assertTheBatchResolvesOnceForTheWholeBatch();
  });

  it("names only the qualified codes the resolver answered null for, once each (F2.22 item 9)", async () => {
    await assertUnresolvedQualifiedCodesNamesOnlyTheNullEntries();
  });

  it("reads nothing when the formula holds no qualified reference (F2.22 item 9)", async () => {
    await assertUnresolvedQualifiedCodesReadsNothingWithoutAQualifiedReference();
  });
});
