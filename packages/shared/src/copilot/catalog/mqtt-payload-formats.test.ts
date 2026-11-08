import { describe, it } from "vitest";

import {
  onlyTheTestRouteStaysExcluded,
  theRtuEntryNamesTheOldAndNewFormat,
  theSummariesSayPlatformWideAndCountTheRtus,
  theThreeFormatEntriesAreTheGlobalAdmins,
} from "./mqtt-payload-formats.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 — the payload format catalog entries (ADR 0099 Amendment 17)", () => {
  it("offers the three format entries to the global admin, the delete red", () => theThreeFormatEntriesAreTheGlobalAdmins());
  it("says platform-wide and counts the RTUs", () => theSummariesSayPlatformWideAndCountTheRtus());
  it("names the RTU and its old and new format", () => theRtuEntryNamesTheOldAndNewFormat());
  it("keeps only the test route excluded and allows the DELETE", () => onlyTheTestRouteStaysExcluded());
});
