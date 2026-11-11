// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aStatusChangeNamesBothStatuses,
  anEmptyListSaysSo,
  eachRowShowsTheStoredActorName,
  onlyASelfApprovedApprovalSaysSo,
  theReasonIsShown,
} from "./work-order-timeline.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 the work-order timeline (ADR 0122 decisions 7 and 8)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the stored actor name on each row, System when null", () => {
    eachRowShowsTheStoredActorName();
  });

  it("names both statuses on a status change", () => {
    aStatusChangeNamesBothStatuses();
  });

  it("says Self-approved only on a self-approved approval", () => {
    onlyASelfApprovedApprovalSaysSo();
  });

  it("shows the reason", () => {
    theReasonIsShown();
  });

  it("says so when there is no history", () => {
    anEmptyListSaysSo();
  });
});
