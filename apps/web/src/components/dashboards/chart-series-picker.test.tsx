// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { rendersAllFourOptionsFromTheCatalog, reflectsTheCurrentValue } from "./chart-series-picker.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1d chart series picker", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders all four series options, read from the catalog", () => {
    rendersAllFourOptionsFromTheCatalog();
  });

  it("reflects the current value", () => {
    reflectsTheCurrentValue();
  });
});
