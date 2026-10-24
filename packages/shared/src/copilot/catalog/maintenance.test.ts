import { describe, it } from "vitest";

import {
  aDirectionSummaryQuotesItsReason,
  eachDirectionFixesActiveInItsModelBody,
  eachDirectionHasAReasonStep,
  noEntryTakesAPrecondition,
  theConvertIsExcluded,
  theCreateSummaryNamesSafetyAndCompliance,
  theCreateSummaryNamesTheSchedule,
  theCreateSummaryOmitsSafetyAndComplianceWhenAbsent,
  theDeactivateIsRedAndTheActivateIsAnEdit,
  theDirectionSummariesNameTheEffect,
  theEntriesAreOfferedToEveryCopilotRole,
  theTargetsMirrorTheRoutes,
} from "./maintenance.spec";

/** `F4.281` — Vitest entry point for the maintenance catalog entries. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.281 — maintenance schedule catalog entries (ADR 0099 Amendment 8)", () => {
  it("the three entries are offered to every copilot role (Q15)", () => theEntriesAreOfferedToEveryCopilotRole());
  it("the targets mirror the routes (D2)", () => theTargetsMirrorTheRoutes());
  it("the deactivate is red and the activate is an edit (D3)", () => theDeactivateIsRedAndTheActivateIsAnEdit());
  it("each direction fixes active in its model body (DC1)", () => eachDirectionFixesActiveInItsModelBody());
  it("each direction has a Reason step and no fixedBody (DC1)", () => eachDirectionHasAReasonStep());
  it("no entry takes a precondition (D6)", () => noEntryTakesAPrecondition());
  it("the create summary names the schedule, asset, organization and cycle", () => theCreateSummaryNamesTheSchedule());
  it("the create summary names safety-critical and the compliance ref when set", () => theCreateSummaryNamesSafetyAndCompliance());
  it("the create summary names neither when both are absent", () => theCreateSummaryOmitsSafetyAndComplianceWhenAbsent());
  it("the direction summaries name the effect (DC5)", () => theDirectionSummariesNameTheEffect());
  it("a direction summary quotes its reason", () => aDirectionSummaryQuotesItsReason());
  it("the convert route is excluded", () => theConvertIsExcluded());
});
