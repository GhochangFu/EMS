import { describe, it } from "vitest";

import {
  aLayoutOutsideTheTurnIsRefused,
  aLayoutReadPageByPageRoundTrips,
  theLayoutListKeepsTheTurnsOrganizations,
  theRoleListHoldsActiveRolesOnly,
  theSymbolListCarriesNoShape,
  theSymbolListHoldsLiveLibrariesOnly,
} from "./mimic-read-tools.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 2 — the mimic read tools (ADR 0099 Amendment 3 drafter choice 1)", () => {
  it("round-trips a 120-node layout read page by page", () => aLayoutReadPageByPageRoundTrips());
  it("refuses a layout outside the turn", () => aLayoutOutsideTheTurnIsRefused());
  it("keeps the turn's organizations in the layout list", () => theLayoutListKeepsTheTurnsOrganizations());
  it("lists live symbol libraries only", () => theSymbolListHoldsLiveLibrariesOnly());
  it("carries no shape in the symbol list", () => theSymbolListCarriesNoShape());
  it("lists active unit roles only", () => theRoleListHoldsActiveRolesOnly());
});
