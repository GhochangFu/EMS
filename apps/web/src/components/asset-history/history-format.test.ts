import { afterAll, beforeAll, describe, it, vi } from "vitest";

import { theAxisLabelIsTimeOverDateInTheSiteZone, theTimeAxisHidesOverlapsAndTheForcedEndLabels } from "./history-format.spec";

/** Vitest entry point (ADR 0014). `TZ` is pinned to a zone no fixture uses. */
beforeAll(() => {
  vi.stubEnv("TZ", "America/St_Johns");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("F4.297 history axis labels", () => {
  it("a label is the time over the date, in the site zone", () => {
    theAxisLabelIsTimeOverDateInTheSiteZone();
  });

  it("the time axis hides overlapping labels and the forced end labels", () => {
    theTimeAxisHidesOverlapsAndTheForcedEndLabels();
  });
});
