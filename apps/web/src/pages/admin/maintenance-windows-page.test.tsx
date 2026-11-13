// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { useAuthStore } from "../../stores/auth-store";
import {
  aConflictShowsItsMessageAndRefetches,
  aLocationAdminSeesThePageAndItsTab,
  anOperatorIsRedirected,
  eachRowOffersOnlyItsStatesActions,
  theThreeSectionsHoldTheRightRows,
} from "./maintenance-windows-page.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ accessToken: null, user: null });
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.359 U15 — the Maintenance windows page (ADR 0131 decision 16)", () => {
  it("P1 the three sections hold the right rows", theThreeSectionsHoldTheRightRows);
  it("P2 Extend and End only on an active row, Cancel only on a future one", eachRowOffersOnlyItsStatesActions);
  it("P3 a 409 shows its message and refetches", aConflictShowsItsMessageAndRefetches);
  it("P4 a location_admin sees the page and its tab", aLocationAdminSeesThePageAndItsTab);
  it("P5 an operator is redirected", anOperatorIsRedirected);
});
