import { describe, it } from "vitest";

import { runContractSuiteMetaTests } from "./adapter-contract-meta.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("adapter conformance suite (ADR 0016 §9)", () => {
  it("rejects every contract violation it claims to catch", async () => {
    await runContractSuiteMetaTests();
  });
});
