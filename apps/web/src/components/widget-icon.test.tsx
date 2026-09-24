// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { rendersEachIconNameWithItsOwnPathData, rendersNothingWhenNoIconNameIsGiven } from "./widget-icon.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.28 WidgetIconGlyph", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders each icon name's own path data", () => {
    rendersEachIconNameWithItsOwnPathData();
  });

  it("renders nothing when no icon name is given", () => {
    rendersNothingWhenNoIconNameIsGiven();
  });
});
