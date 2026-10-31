import { afterEach, describe, it, vi } from "vitest";

import {
  fetchesACustomViewWithBothInstants,
  fetchesTheFilterOptions,
  fetchesTheViewWithARepeatedLocationKey,
  refusesAViewOutsideTheContract,
  throwsOnANonOkFilterOptions,
  throwsOnANonOkView,
} from "./energy-view.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node` default.
 */
describe("F4.298 energy view web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches GET /reports/energy/view with one locationIds key per id", async () => {
    await fetchesTheViewWithARepeatedLocationKey();
  });

  it("sends both instants of a custom range and no absent key", async () => {
    await fetchesACustomViewWithBothInstants();
  });

  it("refuses a view outside the contract", async () => {
    await refusesAViewOutsideTheContract();
  });

  it("throws on a non-OK view status", async () => {
    await throwsOnANonOkView();
  });

  it("fetches GET /reports/energy/filter-options", async () => {
    await fetchesTheFilterOptions();
  });

  it("throws on a non-OK filter-options status", async () => {
    await throwsOnANonOkFilterOptions();
  });
});
