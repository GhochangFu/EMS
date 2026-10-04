import { describe, it } from "vitest";

import {
  assertADraftWithoutTemplatesSkipsTheAuthorCheck,
  assertARuleCodeRaceAnswersTheRouteText,
  assertAnAssetCodeRaceAnswersThePlainCommitText,
  assertAnOpenDraftRaceAnswersTheDraftConflictText,
  assertAssetIdsKeepDraftOrder,
  assertTheCommitRunsTheTemplateWorkInDecisionFourOrder,
  assertTheResultCarriesTheTemplateCounts,
  assertTheSummedAssetCountIsRefused,
  assertTheSummedPointRowsAreRefused,
  assertTheSummedRuleAndWidgetRowsAreRefused,
  assertTheTemplatedGroupIsInstantiatedOntoTheNewRtu,
  assertTwoHundredTemplatedAssetsFit,
} from "./onboarding-commit-templates.spec";

/**
 * `F3.22` (ADR 0091 decisions 4, 5, 10) — Vitest entry point. Assertions live
 * in the sibling `.spec` (§4.6 / ADR 0014). One claim per `it()`.
 */
describe("F3.22 — the onboarding commit publishes and instantiates draft templates (ADR 0091 d4)", () => {
  it("C1: runs the template work in decision 4's order", async () => {
    await assertTheCommitRunsTheTemplateWorkInDecisionFourOrder();
  });

  it("C2: a draft without templates asks no author check and still commits", async () => {
    await assertADraftWithoutTemplatesSkipsTheAuthorCheck();
  });

  it("C3: refuses 2 x 150 templated assets by the summed bound", () => {
    assertTheSummedAssetCountIsRefused();
  });

  it("C3: accepts 2 x 100 templated assets", () => {
    assertTwoHundredTemplatedAssetsFit();
  });

  it("C4: refuses 10,000 summed asset-point rows", () => {
    assertTheSummedPointRowsAreRefused();
  });

  it("C4: refuses the summed rule and widget rows", () => {
    assertTheSummedRuleAndWidgetRowsAreRefused();
  });

  it("C5: keeps assetIds in draft order and maps a later plain asset to its own id", async () => {
    await assertAssetIdsKeepDraftOrder();
  });

  it("C5: instantiates the group onto the RTU this commit wrote, with the organization option", async () => {
    await assertTheTemplatedGroupIsInstantiatedOntoTheNewRtu();
  });

  it("C6: an asset-code race answers the plain commit's 400", async () => {
    await assertAnAssetCodeRaceAnswersThePlainCommitText();
  });

  it("C6: a rule-code race answers the instantiate route's 409", async () => {
    await assertARuleCodeRaceAnswersTheRouteText();
  });

  it("C6: an open-draft race answers translateDraftConflict's text", async () => {
    await assertAnOpenDraftRaceAnswersTheDraftConflictText();
  });

  it("C7: the result carries templateIds and the templated counts", async () => {
    await assertTheResultCarriesTheTemplateCounts();
  });
});
