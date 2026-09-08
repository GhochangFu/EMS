import { describe, it } from "vitest";

import {
  assertDraftArrayCapsAreEnforced,
  assertDraftStringBoundsAreDeclaredOnce,
  assertDraftStringBoundsAreEnforced,
  assertSessionDtoCarriesTheCaps,
  assertSessionDtoCarriesTheStringBounds,
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

describe("F4.104 — the onboarding draft bounds the length of every string field", () => {
  it("declares the bounds once, and they cover every string field of the draft", () => {
    assertDraftStringBoundsAreDeclaredOnce();
  });

  it("attaches every bound, length-only, and refuses one character over", () => {
    assertDraftStringBoundsAreEnforced();
  });

  it("carries the bound into the session DTO the client parses", () => {
    assertSessionDtoCarriesTheStringBounds();
  });
});
