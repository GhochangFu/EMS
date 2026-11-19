import { afterEach, describe, it, vi } from "vitest";

import {
  fetchLocationDashboardForwardsTheQuerySignal,
  fetchLocationKpisForwardsTheQuerySignal,
} from "./locations.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F4.390 location web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetchLocationKpis forwards the query's abort signal to fetch", async () => {
    await fetchLocationKpisForwardsTheQuerySignal();
  });

  it("fetchLocationDashboard forwards the query's abort signal to fetch", async () => {
    await fetchLocationDashboardForwardsTheQuerySignal();
  });
});
