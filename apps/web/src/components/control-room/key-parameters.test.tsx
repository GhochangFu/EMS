// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { aStaleSliceRendersOfflineAndNoNeedleMovement, rendersTheFourGaugeTitles } from "./key-parameters.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.28 Key Parameters gauges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the four gauge titles", () => {
    rendersTheFourGaugeTitles();
  });

  it("renders a stale slice as Offline with the needle at min, not the raw value", () => {
    aStaleSliceRendersOfflineAndNoNeedleMovement();
  });
});
