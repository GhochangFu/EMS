// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  keepsABoundEntryVisibleAndDisabled,
  labelsEveryOptionFromThePresentationMap,
  offersOnlyTheShapesTheWidgetCanDraw,
  rendersNothingForATypeThatBindsNoMetric,
} from "./metric-source-picker.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.35 Stage C — the named-metric picker", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("offers every metric entry and no dataset, for a widget that draws one number", () => {
    offersOnlyTheShapesTheWidgetCanDraw();
  });

  it("labels every option from the presentation map rather than showing the key", () => {
    labelsEveryOptionFromThePresentationMap();
  });

  it("keeps an already-bound entry visible and disabled", () => {
    keepsABoundEntryVisibleAndDisabled();
  });

  it("renders nothing for a widget type that binds no catalog entry", () => {
    rendersNothingForATypeThatBindsNoMetric();
  });
});
