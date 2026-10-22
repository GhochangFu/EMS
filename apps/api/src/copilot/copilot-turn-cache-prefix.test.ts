import "reflect-metadata";

import { describe, it } from "vitest";

import {
  assertTheCachedPrefixIsByteStableAcrossTurns,
  assertTheFixedPromptCarriesNoDateOrOrganization,
} from "./copilot-turn-cache-prefix.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("F4.249 — the copilot's cached prefix (ADR 0099 Amendment 7 C2)", () => {
  it("the tools and the fixed prompt are byte-stable across clocks, scopes and wizards", async () => {
    await assertTheCachedPrefixIsByteStableAcrossTurns();
  });

  it("the fixed prompt carries no date and no organization id", () => {
    assertTheFixedPromptCarriesNoDateOrOrganization();
  });
});
