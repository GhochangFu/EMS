import "reflect-metadata";

import { describe, it } from "vitest";

import {
  aCreateCarriesTheLabelsAndTheCoveredCount,
  aFollowUpTurnRefusesTheCreateAndTheExtendNotTheEnd,
  aLocationOutsideTheGrantIsRefused,
  aLongReasonIsCutAt80,
  anAssetGroupAdminCannotNameALocation,
  anAssetGroupAdminIsAdmitted,
  aCreateStoresItsTargetNamesForTheCard,
  anEndAndACancelInTheWrongStateAreRefused,
  aWindowsLabelsAreInThePagesOrder,
  theEndAndCancelResultsNameTheTargets,
  anExtendOfAPastWindowIsRefusedWithTheRoutesSentence,
  anOperatorAndAViewerAreRefusedBeforeTheScope,
  aPeriodTheRouteRefusesIsRefused,
  aRowTargetWithoutAWindowFailsClosed,
  aScopeReadFailureIsThrownNotRefused,
  aWindowWithATargetOutsideTheScopeIsRefused,
  everyCopilotRoleInScopeResolvesACreate,
  fillStepRefusesAnUnaskedCreate,
  noIntentWordRefusesTheCreateAndTheExtend,
  targetsOfTwoOrganizationsAreRefused,
  theReasonIsInTheHash,
  theRegistryWithholdsTheGatedToolsUnlessAsked,
  theResolverRefusesAnOperatorThroughTheBranch,
} from "./copilot-propose-maintenance-windows.spec";

/** `F4.359` PR 6 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.359 — the Copilot proposes maintenance windows (ADR 0099 Amendment 19)", () => {
  it("every copilot role in scope resolves a create, role class first (Q6)", () => everyCopilotRoleInScopeResolvesACreate());
  it("an operator and a viewer are refused before the scope", () => anOperatorAndAViewerAreRefusedBeforeTheScope());
  it("a location outside the grant is refused", () => aLocationOutsideTheGrantIsRefused());
  it("an asset-group admin cannot name a location", () => anAssetGroupAdminCannotNameALocation());
  it("a scope read failure is thrown, not turned into a refusal", () => aScopeReadFailureIsThrownNotRefused());
  it("targets of two organizations, or a missing one, are refused", () => targetsOfTwoOrganizationsAreRefused());
  it("a create carries the target labels and the covered-asset count (Q5)", () => aCreateCarriesTheLabelsAndTheCoveredCount());
  it("a window with a target outside the scope is refused (D15)", () => aWindowWithATargetOutsideTheScopeIsRefused());
  it("a long reason names the window cut at 80 characters", () => aLongReasonIsCutAt80());
  it("the resolver's branch refuses an operator before any read", () => theResolverRefusesAnOperatorThroughTheBranch());
  it("a follow-up turn refuses the create and the extend, not the end (Q2)", () => aFollowUpTurnRefusesTheCreateAndTheExtendNotTheEnd());
  it("no intent word refuses the create and the extend (Q2)", () => noIntentWordRefusesTheCreateAndTheExtend());
  it("the registry withholds the gated tools unless asked", () => theRegistryWithholdsTheGatedToolsUnlessAsked());
  it("fill_step refuses an unasked create", () => fillStepRefusesAnUnaskedCreate());
  it("the reason is in the hash (Q7)", () => theReasonIsInTheHash());
  it("an extend of a window that is not active is refused with the route's sentence", () =>
    anExtendOfAPastWindowIsRefusedWithTheRoutesSentence());
  it("a window's labels are in the page's order (F4.362 review)", () => aWindowsLabelsAreInThePagesOrder());
  it("a create stores its target names for the card (F4.362 leftover 1)", () => aCreateStoresItsTargetNamesForTheCard());
  it("the end and cancel results name the targets (F4.362 leftover 3)", () => theEndAndCancelResultsNameTheTargets());
  it("an end and a cancel in the wrong state are refused with the routes' sentences", () => anEndAndACancelInTheWrongStateAreRefused());
  it("a period the route refuses is refused with its sentence", () => aPeriodTheRouteRefusesIsRefused());
  it("a row target without a window fails closed", () => aRowTargetWithoutAWindowFailsClosed());
  it("an asset-group admin's dispatch is admitted (Q6)", () => anAssetGroupAdminIsAdmitted());
});
