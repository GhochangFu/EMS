import { describe, it } from "vitest";

import { assertAListedRtuMessageAppendsTheRtu, assertTheProtocolQuestionAnswersTheCatalog } from "./onboarding-chat-protocols.spec";

/** Vitest entry point - see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the guided protocol question (F3.24a, ADR 0093 decision 5)", () => {
  it("answers the code catalog with the fields and the wiring of each protocol", async () => {
    await assertTheProtocolQuestionAnswersTheCatalog();
  });

  it("appends a Modbus RTU when the only question word is inside another word (F4.224)", async () => {
    await assertAListedRtuMessageAppendsTheRtu();
  });
});
