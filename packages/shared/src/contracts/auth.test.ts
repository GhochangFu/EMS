import { describe, it } from "vitest";

import {
  runABodyWithoutACodeParses,
  runAnUnknownCodeIsRefused,
  runTheDeactivatedBodyParsesWithItsCode,
} from "./auth.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.203 — unauthorizedEnvelopeSchema", () => {
  it("A1 — the deactivated body parses with code account_deactivated", () => {
    runTheDeactivatedBodyParsesWithItsCode();
  });

  it("A2 — a 401 body without a code parses", () => {
    runABodyWithoutACodeParses();
  });

  it("A3 — code \"other\" is refused", () => {
    runAnUnknownCodeIsRefused();
  });
});
