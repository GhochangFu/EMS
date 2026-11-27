// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { theTrendLineFollowsTheInputsList, withoutTheSummaryTheCardIsUnchanged } from "./asset-health-trend-line.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  cleanup();
});

describe("E1.5b — the trend line on the asset health card", () => {
  it("draws the summary, Estimated and the info pill after the inputs list", () => theTrendLineFollowsTheInputsList());
  it("without a summary the card's markup is unchanged", () => withoutTheSummaryTheCardIsUnchanged());
});
