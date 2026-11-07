import { describe, it } from "vitest";

import { noPlainRtuIsAnEmptyList, onePlainBesideATlsRtuIsOneEntry } from "./onboarding-commit-plaintext.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.326 — the commit audit's plaintextRtus (ADR 0114 decision 6)", () => {
  it("A1 records one plain RTU by code, beside a TLS one", onePlainBesideATlsRtuIsOneEntry);
  it("A2 records [] when no RTU is plain", noPlainRtuIsAnEmptyList);
});
