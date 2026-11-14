// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import { useAuthStore } from "../../stores/auth-store";
import {
  aCancelledWindowSaysCancelled,
  theRowActionsNameTheirWindow,
  aConflictShowsItsMessageAndRefetches,
  aLocationAdminSeesThePageAndItsTab,
  anOperatorIsRedirected,
  eachRowOffersOnlyItsStatesActions,
  futureListsTheSoonestFirst,
  theSectionsRereadEveryMinute,
  theThreeSectionsHoldTheRightRows,
  theTimesAreInTheBrowsersZone,
} from "./maintenance-windows-page.spec";

beforeAll(() => {
  vi.stubEnv("TZ", "Asia/Kolkata");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ accessToken: null, user: null });
});

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). `TZ` is pinned to
 * Asia/Kolkata (UTC+05:30), so a time shown in UTC rather than the browser's zone fails.
 */
describe("F4.359 U15 — the Maintenance windows page (ADR 0131 decision 16)", () => {
  it("P1 the three sections hold the right rows", theThreeSectionsHoldTheRightRows);
  it("P2 Extend and End only on an active row, Cancel only on a future one", eachRowOffersOnlyItsStatesActions);
  it("P3 a 409 shows its message and refetches", aConflictShowsItsMessageAndRefetches);
  it("P4 a location_admin sees the page and its tab", aLocationAdminSeesThePageAndItsTab);
  it("P5 an operator is redirected", anOperatorIsRedirected);
  it("P6 every time is in the browser's zone, and the columns name it", theTimesAreInTheBrowsersZone);
  it("P7 Future lists the soonest start first", futureListsTheSoonestFirst);
  it("P8 the sections re-read every minute", theSectionsRereadEveryMinute);
  it("P9 a cancelled window says Cancelled by, with no end time (F4.360)", aCancelledWindowSaysCancelled);
  it("P10 each row action names its window (F4.360)", theRowActionsNameTheirWindow);
});
