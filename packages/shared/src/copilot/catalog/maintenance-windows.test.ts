import { describe, it } from "vitest";

import {
  noWindowRouteIsExcludedNow,
  theBodiesAreTheRoutesExports,
  theCreateSummaryNamesEverything,
  theCreateSummaryNamesItsStartAndNoCoverWithoutALocation,
  theEndAndCancelSummariesNameTheWindow,
  theEntriesAreEveryCopilotRolesAndTheModels,
  theExtendSummaryNamesTheWindowAndBothEnds,
  theFourEntriesHaveTheirRoutesRisksAndColours,
  theModelBodyRefuses26TargetsAndTheRouteTakesThem,
  theStepsAreTheAmendments,
  theSummariesSayTimesInTheGivenZone,
  theTargetsAreTheWindowKind,
} from "./maintenance-windows.spec";

/** `F4.359` PR 6 — Vitest entry point for the maintenance-window catalog entries. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.359 — maintenance-window catalog entries (ADR 0099 Amendment 19)", () => {
  it("the four entries have their routes and risks; create and extend are red (Q1)", () => theFourEntriesHaveTheirRoutesRisksAndColours());
  it("the targets are the maintenanceWindow kind (decision 2)", () => theTargetsAreTheWindowKind());
  it("every copilot role, the model proposes, nothing client-only (Q6)", () => theEntriesAreEveryCopilotRolesAndTheModels());
  it("the bodies are the routes' exports by identity", () => theBodiesAreTheRoutesExports());
  it("the model body refuses 26 targets and the route takes them (Q4)", () => theModelBodyRefuses26TargetsAndTheRouteTakesThem());
  it("the steps are the amendment's", () => theStepsAreTheAmendments());
  it("the create summary names the organization, targets, covered count and reason (Q5, Q7)", () => theCreateSummaryNamesEverything());
  it("the create summary names its start, and no cover without a location", () =>
    theCreateSummaryNamesItsStartAndNoCoverWithoutALocation());
  it("the extend summary names the window and both ends", () => theExtendSummaryNamesTheWindowAndBothEnds());
  it("the end and cancel summaries name the window", () => theEndAndCancelSummariesNameTheWindow());
  it("the summaries say times in the given zone, UTC by default (F4.360)", () => theSummariesSayTimesInTheGivenZone());
  it("no maintenance-window route is excluded now", () => noWindowRouteIsExcludedNow());
});
