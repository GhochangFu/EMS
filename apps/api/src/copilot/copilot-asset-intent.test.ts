import { describe, it } from "vitest";

import { assertOtherMessagesDoNotAsk, assertTheAssetWordsAsk } from "./copilot-asset-intent.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 7 — the asset-intent word test (plan D8)", () => {
  it("finds an asset word in four asking messages", () => assertTheAssetWordsAsk());
  it("finds none in four other messages", () => assertOtherMessagesDoNotAsk());
});
