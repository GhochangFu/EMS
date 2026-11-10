import { describe, it } from "vitest";

import {
  atRiskStartsBelowTwentyPercent,
  defaultsAreTheRuledFour,
  formatsLikeTheReference,
  noSlaReadsNone,
  resolvedIsMetOrMissed,
  unresolvedPastDueIsBreached,
} from "./work-order-sla.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 — work-order SLA (ADR 0122 decision 3)", () => {
  it("defaults to 30 minutes, 1 hour, 4 hours and 24 hours", () => {
    defaultsAreTheRuledFour();
  });

  it("reads none for a ticket with no SLA", () => {
    noSlaReadsNone();
  });

  it("is met when resolved on or before the due instant, missed after it", () => {
    resolvedIsMetOrMissed();
  });

  it("is breached when unresolved past the due instant", () => {
    unresolvedPastDueIsBreached();
  });

  it("turns at_risk below 20% of the window, not at it", () => {
    atRiskStartsBelowTwentyPercent();
  });

  it("formats minutes as the reference layout does", () => {
    formatsLikeTheReference();
  });
});
