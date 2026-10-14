import { describe, it } from "vitest";

import {
  aStateMapParses,
  anUnknownToneIsRefused,
  earthedIsRefused,
  shutIsAccepted,
  toneVocabularyIsExactlyFive,
} from "./point-key-states.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.74 — the point-key state map contract (ADR 0088, plan D3)", () => {
  it("declares exactly the five tones closed, open, tripped, flowing and shut", () => {
    toneVocabularyIsExactlyFive();
  });

  it("refuses an unknown tone", () => {
    anUnknownToneIsRefused();
  });

  it("refuses the tone 'earthed'", () => {
    earthedIsRefused();
  });

  it("accepts a state row with the tone 'shut'", () => {
    shutIsAccepted();
  });

  it("parses a map of one point key and its rows", () => {
    aStateMapParses();
  });
});
