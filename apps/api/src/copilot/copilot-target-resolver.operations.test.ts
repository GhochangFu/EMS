import { describe, it } from "vitest";

import {
  anAlarmInAnotherOrganizationIsRefused,
  anAlarmOutsideTheScopeIsRefused,
  anAssigneeOfTheOrganizationBelongs,
  anAssigneeOutsideTheOrganizationIsRefused,
  anEnrichmentWithAForeignAffectedAssetIsRefused,
  anEnrichmentWithAnUnreadableAffectedAssetIsRefused,
  aReorderOutsideTheScopeIsRefused,
  aReorderWithADuplicateIsRefused,
  aReorderWithAMissingWorkOrderIsRefused,
  aViewerIsRefusedTheAlarm,
  aViewerIsRefusedTheWorkOrder,
  everyCopilotRoleResolvesTheAlarm,
  everyCopilotRoleResolvesTheWorkOrder,
  theAlarmTargetCarriesTheAlarm,
  theAssigneeIsNamed,
  theConvertRunsTheOperationalGate,
  theCreateResolvesTheBodysAsset,
  theReorderCarriesTheBatch,
  theStatusChangeAssigneeIsNamed,
} from "./copilot-target-resolver.operations.spec";

/** `F4.284` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.284 — the alarm and work-order targets mirror the routes' gate (ADR 0106 decision 6)", () => {
  it("resolves each copilot role on an alarm, asking the operational class then the read scope", () => everyCopilotRoleResolvesTheAlarm());
  it("refuses a viewer an alarm before the scope is read", () => aViewerIsRefusedTheAlarm());
  it("refuses an alarm whose asset is outside the read scope", () => anAlarmOutsideTheScopeIsRefused());
  it("carries the alarm the card names and its organization", () => theAlarmTargetCarriesTheAlarm());
  it("refuses an alarm in no allowed organization", () => anAlarmInAnotherOrganizationIsRefused());
  it("refuses an enrichment whose affected asset is outside the read scope", () => anEnrichmentWithAnUnreadableAffectedAssetIsRefused());
  it("refuses an enrichment whose affected asset the organization does not hold", () => anEnrichmentWithAForeignAffectedAssetIsRefused());
  it("resolves each copilot role on a work order, with its title, status and asset", () => everyCopilotRoleResolvesTheWorkOrder());
  it("refuses a viewer a work order", () => aViewerIsRefusedTheWorkOrder());
  it("resolves a work-order create on the body's asset, in scope only", () => theCreateResolvesTheBodysAsset());
  it("carries a reorder's work orders as they are now", () => theReorderCarriesTheBatch());
  it("refuses a reorder naming a work order no allowed organization has", () => aReorderWithAMissingWorkOrderIsRefused());
  it("refuses a reorder naming one work order twice", () => aReorderWithADuplicateIsRefused());
  it("refuses a reorder naming a work order outside the read scope", () => aReorderOutsideTheScopeIsRefused());
  it("runs the operational gate on a convert and carries its state (DC5)", () => theConvertRunsTheOperationalGate());
  it("admits an assignee the organization holds", () => anAssigneeOfTheOrganizationBelongs());
  it("refuses an assignee the organization does not hold (DC1)", () => anAssigneeOutsideTheOrganizationIsRefused());
  it("names a create's assignee by display name (refName)", () => theAssigneeIsNamed());
  it("names a status change's assignee by display name (refName)", () => theStatusChangeAssigneeIsNamed());
});
