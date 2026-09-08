import { describe, it } from "vitest";

import {
  assertDraftArrayCapsAreEnforced,
  assertSessionDtoCarriesTheCaps,
} from "./onboarding.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.103 — the onboarding draft carries a count cap on all four arrays", () => {
  it("parses a draft at each cap and refuses one item over it", () => {
    assertDraftArrayCapsAreEnforced();
  });

  it("carries the cap into the session DTO the client parses", () => {
    assertSessionDtoCarriesTheCaps();
  });
});
