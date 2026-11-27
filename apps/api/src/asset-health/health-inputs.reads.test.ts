import { describe, it } from "vitest";

import {
  theHoursReadFiltersByAssetWheneverIdsAreGiven,
  theHoursReadKeepsTheFencedChain,
  theLabelReadBindsTheIds,
  theLineAndTheDetectorsAreParameters,
  theTicketReadBindsTheAssetAndTheStatusList,
} from "./health-inputs.reads.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.8a — the health inputs statements (ADR 0050 Amendment 5, plan T1.5)", () => {
  it("the hours read filters by asset whenever ids are given, and not for null", () =>
    theHoursReadFiltersByAssetWheneverIdsAreGiven());
  it("the hours read keeps the imported chain's OFFSET 0 fence and newest-run pick", () => theHoursReadKeepsTheFencedChain());
  it("the unusual-score line and both detector names are parameters; strong needs both detectors", () =>
    theLineAndTheDetectorsAreParameters());
  it("the ticket read binds the asset id and the closed-status list; linked tickets are left out", () =>
    theTicketReadBindsTheAssetAndTheStatusList());
  it("the label read binds the ids through uuidArray", () => theLabelReadBindsTheIds());
});
