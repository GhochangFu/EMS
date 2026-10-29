import { describe, it } from "vitest";

import {
  aBareLocationIdReachesTheScopeAsAList,
  noLocationIdsAsksForTheUnfilteredScope,
  theRoutePassesTheLocationIdsToTheScope,
  theScopesAnswerIsTheRenderersAssetScope,
} from "./reports.controller.scope.spec";

/** `F4.290` — Vitest entry point for the energy routes' site filter. Assertions live in the sibling `.spec` (§4.6). */
describe.each(["energyPreview", "energyCsv", "energyXlsx", "energyPdf"] as const)("F4.290 — %s takes locationIds", (route) => {
  it("passes the query's locationIds to the scope service", () => theRoutePassesTheLocationIdsToTheScope(route));
  it("folds one bare ?locationIds= into a list", () => aBareLocationIdReachesTheScopeAsAList(route));
  it("asks for the unfiltered scope without locationIds", () => noLocationIdsAsksForTheUnfilteredScope(route));
  it("renders under the scope service's answer", () => theScopesAnswerIsTheRenderersAssetScope(route));
});
