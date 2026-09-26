// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  cleanupRetry,
  tryAgainCallsTheResolveReadTwice,
  tryAgainShowsTheFailSafeOnRemoval,
} from "./site-page-dashboard-retry.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.69 U3 SiteDashboardView Try again binds the site page's resolve read", () => {
  afterEach(() => {
    cleanupRetry();
  });

  it("R1 calls the resolve read a second time after Try again", async () => {
    await tryAgainCallsTheResolveReadTwice();
  });

  it("R2 shows the fail-safe banner and the generated view end to end", async () => {
    await tryAgainShowsTheFailSafeOnRemoval();
  });
});
