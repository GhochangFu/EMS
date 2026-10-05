import { describe, it } from "vitest";

import {
  assertADraftThatUsesTheExistingCatalogIsNotGivenAPointKey,
  assertADraftWithAPlainAssetIsStillGivenAPointKey,
  assertAnAllTemplatedReviewDraftIsNotGivenAPointKey,
  assertTheMappingAddedAnswerOffersCreateItAndViewDraft,
  assertTheYesAnswerOffersOnlyViewDraft,
  assertTheImportFollowUpSendsAnAllTemplatedDraftToCommit,
  assertTheImportFollowUpStillAsksAPlainAssetToMap,
} from "./onboarding-chat-point-keys.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("onboarding chat point-key step (F4.195)", () => {
  it("adds no point key to an all-templated review draft", async () => {
    await assertAnAllTemplatedReviewDraftIsNotGivenAPointKey();
  });

  it("adds no point key to a draft that uses the existing catalog", async () => {
    await assertADraftThatUsesTheExistingCatalogIsNotGivenAPointKey();
  });

  it("still adds kw to a draft with a plain asset and no point key", async () => {
    await assertADraftWithAPlainAssetIsStillGivenAPointKey();
  });

  it("sends an imported all-templated draft to commit", () => {
    assertTheImportFollowUpSendsAnAllTemplatedDraftToCommit();
  });

  it("still asks an imported plain asset to map", () => {
    assertTheImportFollowUpStillAsksAPlainAssetToMap();
  });

  it("F4.199: offers only View draft after a yes", async () => {
    await assertTheYesAnswerOffersOnlyViewDraft();
  });

  it("F4.199: offers create it and View draft after a mapping is added", async () => {
    await assertTheMappingAddedAnswerOffersCreateItAndViewDraft();
  });
});
