import { describe, it } from "vitest";

import {
  assertTheAssetTurnAnswersItsActionLine,
  assertAutoMapMapsEveryUnmappedPlainAsset,
  assertAutoMapSkipsMappedAndTemplatedAssets,
  assertTheDepthBoundIsAGuidedRefusal,
  assertACredentialLookingNameIsAGuidedRefusal,
  assertAPromptMarkerNameIsAGuidedRefusal,
  assertAGuidedTurnStoresItsActionMessage,
  assertAnythingButTheLabelWritesNothing,
  assertNoGuidedReplyNamesAnInputTheCodeDoesNotParse,
  assertTheChangedGuidedTextIsExact,
  assertTheImportFollowUpsAreExact,
  assertTheOfferedLabelsStillWrite,
  assertTheReviewReplyIsExact,
  assertTheReviewReplyPointsAtTheAssetTemplatesEditor,
} from "./onboarding-chat-guided.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the guided onboarding prompts and label-only writes (F3.27 U2)", () => {
  it("names no input the code does not parse", async () => {
    await assertNoGuidedReplyNamesAnInputTheCodeDoesNotParse();
  });

  it("changed prompts and replies match the exact text", async () => {
    await assertTheChangedGuidedTextIsExact();
  });

  it("the review reply is the exact constant", async () => {
    await assertTheReviewReplyIsExact();
  });

  it("the review reply points at the Asset Templates editor", async () => {
    await assertTheReviewReplyPointsAtTheAssetTemplatesEditor();
  });

  it("the import follow-ups are exact", () => {
    assertTheImportFollowUpsAreExact();
  });

  it("a message that is not the label writes nothing", async () => {
    await assertAnythingButTheLabelWritesNothing();
  });

  it("the offered labels still write", async () => {
    await assertTheOfferedLabelsStillWrite();
  });
});

describe("the guided writes run through the tool registry (F3.27 U4: B4, B5, Q-C, Q-D)", () => {
  it("the asset turn answers the add_asset action line", async () => {
    await assertTheAssetTurnAnswersItsActionLine();
  });

  it("auto map maps every unmapped plain asset, one line each", async () => {
    await assertAutoMapMapsEveryUnmappedPlainAsset();
  });

  it("auto map skips a mapped and a templated asset", async () => {
    await assertAutoMapSkipsMappedAndTemplatedAssets();
  });

  it("a draft past the depth bound is a guided refusal", async () => {
    await assertTheDepthBoundIsAGuidedRefusal();
  });

  it("a credential-looking location name is a guided refusal", async () => {
    await assertACredentialLookingNameIsAGuidedRefusal();
  });

  it("a prompt-marker location name is a guided refusal", async () => {
    await assertAPromptMarkerNameIsAGuidedRefusal();
  });

  it("a guided turn stores its action message through OnboardingService.chat", async () => {
    await assertAGuidedTurnStoresItsActionMessage();
  });
});
