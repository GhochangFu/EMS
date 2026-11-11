// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aRefusalShowsTheSentence,
  anOutOfRangeValueDisablesSave,
  failsClosedForOtherRoles,
  savingSendsOnlyTheOrganizationsRows,
  showsFourRowsInOrderWithMarkers,
  useDefaultLeavesTheRowOut,
} from "./work-order-sla-policies-page.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); `E3.1`, ADR 0122. */
describe("E3.1 Work Order SLA admin page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("S1 fails closed for other roles, with no request", async () => {
    await failsClosedForOtherRoles();
  });
  it("S2 shows four rows in order with their markers", async () => {
    await showsFourRowsInOrderWithMarkers();
  });
  it("S3 Save sends only the organization's rows", async () => {
    await savingSendsOnlyTheOrganizationsRows();
  });
  it("S4 Use default leaves the row out of the write", async () => {
    await useDefaultLeavesTheRowOut();
  });
  it("S5 an out-of-range value disables Save", async () => {
    await anOutOfRangeValueDisablesSave();
  });
  it("S6 a refusal shows the server's sentence", async () => {
    await aRefusalShowsTheSentence();
  });
});
