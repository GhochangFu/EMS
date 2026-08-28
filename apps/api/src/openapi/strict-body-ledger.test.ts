import { describe, it } from "vitest";

import {
  testEveryNodeHasARecordedDecision,
  testEveryRegisteredSchemaIsUnderAudit,
  testTheLedgerHasNoEntriesForNodesThatAreGone,
  testTheWalkHandlesEveryConstructItMeets,
} from "./strict-body-ledger.spec";

/**
 * `E7.1f` — Vitest entry point. Assertions live in the sibling `.spec` (§4.6).
 */
describe("E7.1f — every request body object node carries a strictness decision", () => {
  it("descends every Zod construct in the tree and finds the object nodes", () => {
    testTheWalkHandlesEveryConstructItMeets();
  });

  it("has every registered request schema under audit", () => {
    testEveryRegisteredSchemaIsUnderAudit();
  });

  it("has a recorded decision, matching the code, for every object node", () => {
    testEveryNodeHasARecordedDecision();
  });

  it("records no decision for a node that no longer exists", () => {
    testTheLedgerHasNoEntriesForNodesThatAreGone();
  });
});
