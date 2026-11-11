import { describe, it } from "vitest";

import {
  aReorderItemTakesTheFiveColumns,
  rejectAndCancelTakeAReasonOnly,
  theAckBodyIsStrict,
  theAckBodyRefusesAShortReason,
  theCloseBodyIsStrict,
  theCreateBodyIsStrict,
  theEnrichmentBodyIsStrict,
  theEnrichmentModelBodyAcceptsTheAnalysis,
  theEnrichmentModelBodyAcceptsASkillCode,
  theReorderBodyIsStrict,
  theReorderBodyRefuses101Items,
  theStatusBodyIsStrict,
  theStatusModelBodyAcceptsTheOtherFour,
  theStatusModelBodyIsStrict,
  theStatusBodyTakesTheFourSettableStatuses,
  theStatusModelBodyRefusesClosed,
  theTerminalStatusesAreClosedAndCancelled,
} from "./operations-writes.spec";

/** `F4.284` — Vitest entry point for the alarm and work-order write bodies. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.284 — alarm and work-order write bodies (ADR 0030)", () => {
  it("the ack body refuses an unknown key", () => theAckBodyIsStrict());
  it("the ack body refuses a reason under 3 characters", () => theAckBodyRefusesAShortReason());
  it("the enrichment body refuses an unknown key", () => theEnrichmentBodyIsStrict());
  it("the enrichment model body accepts a skillCode (ruling 2026-10-25)", () => theEnrichmentModelBodyAcceptsASkillCode());
  it("the enrichment model body accepts the analysis fields", () => theEnrichmentModelBodyAcceptsTheAnalysis());
  it("the create body refuses an unknown key", () => theCreateBodyIsStrict());
  it("the status body refuses an unknown key", () => theStatusBodyIsStrict());
  it("the status model body refuses closed", () => theStatusModelBodyRefusesClosed());
  it("the status model body accepts the other four statuses", () => theStatusModelBodyAcceptsTheOtherFour());
  it("the status model body refuses an unknown key", () => theStatusModelBodyIsStrict());
  it("the close body refuses an unknown key", () => theCloseBodyIsStrict());
  it("the reorder body refuses an unknown key", () => theReorderBodyIsStrict());
  it("the reorder body refuses 101 items", () => theReorderBodyRefuses101Items());
  it("E3.1: the status body takes the four settable statuses, never closed or cancelled", () => theStatusBodyTakesTheFourSettableStatuses());
  it("E3.1: a reorder item takes the five columns, never cancelled", () => aReorderItemTakesTheFiveColumns());
  it("E3.1: reject and cancel take a reason only", () => rejectAndCancelTakeAReasonOnly());
  it("E3.1: the terminal statuses are closed and cancelled", () => theTerminalStatusesAreClosedAndCancelled());
});
