// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { encodesTheId, redirectsToTheAssetsTab } from "./location-dashboard-redirect.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.72 LocationDashboardRedirect", () => {
  afterEach(() => {
    cleanup();
  });

  it("R1 redirects the old location dashboard address to the Assets & RTUs tab, with replace", async () => {
    await redirectsToTheAssetsTab();
  });

  it("R2 encodes the location id in the redirect", async () => {
    await encodesTheId();
  });
});
