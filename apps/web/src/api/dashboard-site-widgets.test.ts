import { afterEach, describe, it, vi } from "vitest";

import { fetchSiteWidgetsForwardsTheQuerySignal } from "./dashboard-site-widgets.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F3.73 site-widgets web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("forwards the query's abort signal to fetch", async () => {
    await fetchSiteWidgetsForwardsTheQuerySignal();
  });
});
