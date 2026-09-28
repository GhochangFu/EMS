// @vitest-environment jsdom
import { describe, it } from "vitest";

import {
  highAndMediumPillsDiffer,
  highPillIsTheRuledStrongWarning,
  mediumPillIsTheRuledSoftWarning,
} from "./maintenance-schedules-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * jsdom docblock is here because Vitest reads it from the file it collects
 * (ADR 0042 decision 2).
 */
describe("F3.65b maintenance-schedule priority colours (owner ruling R-f)", () => {
  it("renders the high and medium priority pills differently", () => {
    highAndMediumPillsDiffer();
  });

  it("gives the high pill the solid warning line on the strong wash", () => {
    highPillIsTheRuledStrongWarning();
  });

  it("gives the medium pill the soft warning line on the plain wash", () => {
    mediumPillIsTheRuledSoftWarning();
  });
});
