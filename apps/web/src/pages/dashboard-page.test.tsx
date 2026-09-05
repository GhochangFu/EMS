// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aMeasuredRatioRendersOnTheDashboard,
  anUnconfiguredEstateShowsTheDashAndTheReason,
} from "./dashboard-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F2.8 executive dashboard PUE tile", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a measured ratio to two decimals", async () => {
    await aMeasuredRatioRendersOnTheDashboard();
  });

  it("renders a dash and the not-configured reason when the API returns null", async () => {
    await anUnconfiguredEstateShowsTheDashAndTheReason();
  });
});
