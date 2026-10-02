import { describe, it } from "vitest";

import { aStateMapParses, anUnknownToneIsRefused, toneVocabularyIsExactlyThree } from "./point-key-states.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.74 — the point-key state map contract (ADR 0088, plan D3)", () => {
  it("declares exactly the three tones closed, open and tripped", () => {
    toneVocabularyIsExactlyThree();
  });

  it("refuses an unknown tone", () => {
    anUnknownToneIsRefused();
  });

  it("parses a map of one point key and its rows", () => {
    aStateMapParses();
  });
});
