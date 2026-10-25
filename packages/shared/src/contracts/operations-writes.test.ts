import { describe, it } from "vitest";

import {
  theAckBodyIsStrict,
  theAckBodyRefusesAShortReason,
  theCloseBodyIsStrict,
  theCreateBodyIsStrict,
  theEnrichmentBodyIsStrict,
  theEnrichmentModelBodyAcceptsTheAnalysis,
  theEnrichmentModelBodyRefusesSkillCode,
  theReorderBodyIsStrict,
  theReorderBodyRefuses101Items,
  theStatusBodyIsStrict,
  theStatusModelBodyAcceptsTheOtherFour,
  theStatusModelBodyIsStrict,
  theStatusModelBodyRefusesClosed,
} from "./operations-writes.spec";

/** `F4.284` — Vitest entry point for the alarm and work-order write bodies. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.284 — alarm and work-order write bodies (ADR 0030)", () => {
  it("the ack body refuses an unknown key", () => theAckBodyIsStrict());
  it("the ack body refuses a reason under 3 characters", () => theAckBodyRefusesAShortReason());
  it("the enrichment body refuses an unknown key", () => theEnrichmentBodyIsStrict());
  it("the enrichment model body refuses skillCode", () => theEnrichmentModelBodyRefusesSkillCode());
  it("the enrichment model body accepts the analysis fields", () => theEnrichmentModelBodyAcceptsTheAnalysis());
  it("the create body refuses an unknown key", () => theCreateBodyIsStrict());
  it("the status body refuses an unknown key", () => theStatusBodyIsStrict());
  it("the status model body refuses closed", () => theStatusModelBodyRefusesClosed());
  it("the status model body accepts the other four statuses", () => theStatusModelBodyAcceptsTheOtherFour());
  it("the status model body refuses an unknown key", () => theStatusModelBodyIsStrict());
  it("the close body refuses an unknown key", () => theCloseBodyIsStrict());
  it("the reorder body refuses an unknown key", () => theReorderBodyIsStrict());
  it("the reorder body refuses 101 items", () => theReorderBodyRefuses101Items());
});
