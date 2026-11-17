import { describe, it } from "vitest";

import { emptyCardsAreNotSentByDesign, everyFactLineTheBuildersWriteIsSendable } from "./findings-sendable.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9c — every fact sentence the builders write is sendable", () => {
  it("F1–F5 (all three F5 forms), F_MORE and A1–A4 (the A2 tail, both A4 forms) are sendable", () =>
    everyFactLineTheBuildersWriteIsSendable());
  it("F_NONE and A_NONE cards are not sent, by design", () => emptyCardsAreNotSentByDesign());
});
