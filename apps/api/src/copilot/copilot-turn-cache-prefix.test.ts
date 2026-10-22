import "reflect-metadata";

import { describe, it } from "vitest";

import {
  assertTheFixedPromptCarriesNoDateOrOrganization,
  assertTheFixedPromptIsByteStableAcrossTurns,
  assertTheToolDefinitionsAreByteStableAcrossTurns,
} from "./copilot-turn-cache-prefix.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("F4.249 — the copilot's cached prefix (ADR 0099 Amendment 7 C2)", () => {
  it("the fixed prompt is byte-stable across clocks, scopes and wizards", async () => {
    await assertTheFixedPromptIsByteStableAcrossTurns();
  });

  it("the tool definitions, over the real read registry, are byte-stable across clocks, scopes and wizards", async () => {
    await assertTheToolDefinitionsAreByteStableAcrossTurns();
  });

  it("the fixed prompt carries no date and no organization id", () => {
    assertTheFixedPromptCarriesNoDateOrOrganization();
  });
});
