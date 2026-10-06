import { describe, it } from "vitest";

import {
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
