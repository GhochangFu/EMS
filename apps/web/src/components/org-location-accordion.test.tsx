// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import { cleanupAccordion, eachHeaderShowsItsLiveAndNotLiveChips } from "./org-location-accordion.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.261 OrgLocationAccordion", () => {
  afterEach(() => {
    cleanupAccordion();
  });

  it("A1 shows each organization's live and not-live chips in its header", () => {
    eachHeaderShowsItsLiveAndNotLiveChips();
  });
});
