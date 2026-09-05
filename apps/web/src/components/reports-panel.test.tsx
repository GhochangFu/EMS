// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aMeasuredRatioRendersInTheReportsPanel,
  anUnconfiguredPreviewShowsTheDashAndTheReason,
} from "./reports-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F2.8 reports panel PUE tile", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a measured ratio to two decimals", async () => {
    await aMeasuredRatioRendersInTheReportsPanel();
  });

  it("renders a dash and the not-configured reason when the API returns null", async () => {
    await anUnconfiguredPreviewShowsTheDashAndTheReason();
  });
});
