import { describe, it } from "vitest";

import { assertOtherMessagesDoNotAsk, assertTheAccessWordsAsk } from "./copilot-access-intent.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 4 — the access-intent gate's word test (ruling Q3)", () => {
  it("finds an access word in five asking messages", () => assertTheAccessWordsAsk());
  it("finds none in five other messages", () => assertOtherMessagesDoNotAsk());
});
