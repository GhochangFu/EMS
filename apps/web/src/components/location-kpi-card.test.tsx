// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  cleanupCard,
  theDefaultLinksToTheLocationDashboard,
  toReplacesTheLinkTarget,
} from "./location-kpi-card.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.66 U3 LocationKpiCard link target (D4)", () => {
  afterEach(() => {
    cleanupCard();
  });

  it("K1 links to the location dashboard by default", () => {
    theDefaultLinksToTheLocationDashboard();
  });

  it("K2 links to `to` when it is given", () => {
    toReplacesTheLinkTarget();
  });
});
