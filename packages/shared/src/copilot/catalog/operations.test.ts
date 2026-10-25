import { describe, it } from "vitest";

import {
  noEntryTakesAPrecondition,
  noOperationsRouteIsExcluded,
  onlyTheAckAndTheCloseAreOperational,
  theAckHasAReasonStep,
  theAckSummaryNamesTheAlarm,
  theBodyNamesAreTheRoutesExports,
  theCloseSummaryQuotesItsReason,
  theEnrichmentChecksItsSkillCodeAsARef,
  theEnrichmentModelBodyCarriesSkillCode,
  theEntriesAreOfferedToEveryCopilotRole,
  theRefsNameTheAssigneeAndTheAlarm,
  theReorderIsACanvasEntryWithCardOnlyMoves,
  theReorderSummaryCountsTheWorkOrders,
  theRisksAreAsRuled,
  theSixRoutesAreEntries,
  theStatusModelBodyLeavesOutClosed,
  theStatusSummaryNamesFromAndTo,
  theTargetsMirrorTheRoutes,
} from "./operations.spec";

/** `F4.284` — Vitest entry point for the alarm and work-order catalog entries. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.284 — alarm and work-order catalog entries (ADR 0106)", () => {
  it("the six routes are entries (decision 2)", () => theSixRoutesAreEntries());
  it("no alarm or work-order route is excluded", () => noOperationsRouteIsExcluded());
  it("each body is the route's own export by name", () => theBodyNamesAreTheRoutesExports());
  it("the risks are as ruled (decision 4)", () => theRisksAreAsRuled());
  it("only the ack and the close are operational in the catalog", () => onlyTheAckAndTheCloseAreOperational());
  it("the targets mirror the routes (decision 6, DC5)", () => theTargetsMirrorTheRoutes());
  it("the refs name the assignee and the alarm", () => theRefsNameTheAssigneeAndTheAlarm());
  it("the entries are offered to every copilot role (Q1)", () => theEntriesAreOfferedToEveryCopilotRole());
  it("no entry takes a precondition", () => noEntryTakesAPrecondition());
  it("the ack has a Reason step and hashes the reason (decision 3)", () => theAckHasAReasonStep());
  it("the status model body leaves out closed (decision 2)", () => theStatusModelBodyLeavesOutClosed());
  it("the enrichment model body carries skillCode (ruling 2026-10-25)", () => theEnrichmentModelBodyCarriesSkillCode());
  it("the enrichment checks its skillCode as an alarmSkill ref", () => theEnrichmentChecksItsSkillCodeAsARef());
  it("the reorder is a canvas entry with card-only moves (DC2)", () => theReorderIsACanvasEntryWithCardOnlyMoves());
  it("the ack summary names the alarm text, severity, asset and raised time", () => theAckSummaryNamesTheAlarm());
  it("the status summary names from and to", () => theStatusSummaryNamesFromAndTo());
  it("the reorder summary counts the work orders", () => theReorderSummaryCountsTheWorkOrders());
  it("the close summary quotes its reason", () => theCloseSummaryQuotesItsReason());
});
