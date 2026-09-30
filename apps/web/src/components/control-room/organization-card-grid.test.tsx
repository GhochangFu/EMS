// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  cleanupGrid,
  eachOrganizationCardLinksToItsLevel,
  theCardReadsSitesOnlineAndAlarms,
} from "./organization-card-grid.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.72 U1 OrganizationCardGrid", () => {
  afterEach(() => {
    cleanupGrid();
  });

  it("O1 links each organization card to its organization level", () => {
    eachOrganizationCardLinksToItsLevel();
  });

  it("O2 reads '2 sites · 1 online · 3 alarms' on the A card", () => {
    theCardReadsSitesOnlineAndAlarms();
  });
});
