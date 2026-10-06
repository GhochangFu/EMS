import { describe, it } from "vitest";

import {
  assertACountCapIsRefusedWithTheCapSentence,
  assertACredentialIsRefused,
  assertAPassingWriteAnswersItsActionLine,
  assertAPromptMarkerIsRefused,
  assertASchemaRefusalIsTheGuidedSentence,
  assertAnUnclassifiedRefusalFailsClosed,
  assertEveryToolIsClassified,
  assertTheDepthBoundIsRefused,
} from "./onboarding-guided-writes.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("guidedWrite over the tool registry (F3.27 U3)", () => {
  it("refuses a count cap with the cap sentence", async () => {
    await assertACountCapIsRefusedWithTheCapSentence();
  });

  it("refuses a credential with the guided sentence", async () => {
    await assertACredentialIsRefused();
  });

  it("refuses the prompt-budget marker", async () => {
    await assertAPromptMarkerIsRefused();
  });

  it("answers a passing write with its code-written action line", async () => {
    await assertAPassingWriteAnswersItsActionLine();
  });

  it("refuses a write on a draft past the depth bound", async () => {
    await assertTheDepthBoundIsRefused();
  });

  it("answers a schema refusal with the guided sentence", async () => {
    await assertASchemaRefusalIsTheGuidedSentence();
  });

  it("fails closed on a refusal it does not classify", async () => {
    await assertAnUnclassifiedRefusalFailsClosed();
  });

  it("classifies every registry tool", () => {
    assertEveryToolIsClassified();
  });
});
