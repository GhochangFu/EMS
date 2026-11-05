// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aRuleWithNoAssetKeepsThePlaceholder,
  theSummaryFallsBackToTheLocation,
  theSummaryNamesTheAssetByCodeAndRtu,
} from "./rules-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * `@vitest-environment jsdom` docblock is on THIS file (ADR 0042 decision 2).
 */
describe("F4.316 PR 4b — the Rule Engine card names its asset as code · RTU (ADR 0111)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("prints <code> · <RTU> before the point", () => theSummaryNamesTheAssetByCodeAndRtu());
  it("falls back to the location name when the asset has no RTU", () => theSummaryFallsBackToTheLocation());
  it("keeps the Asset placeholder for a rule with no asset", () => aRuleWithNoAssetKeepsThePlaceholder());
});
