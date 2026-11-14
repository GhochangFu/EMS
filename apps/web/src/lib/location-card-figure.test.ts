import { describe, it } from "vitest";

import { runKwText } from "./location-card-figure.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.364 — location card figures", () => {
  it("F1 — kwText: null is a dash, a number one decimal", () => {
    runKwText();
  });
});
