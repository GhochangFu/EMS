import { describe, it } from "vitest";

import { runLooksLikeCredentialTests } from "./credential-detect.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("credential detection", () => {
  it("refuses turns carrying secrets without breaking wizard vocabulary", () => {
    runLooksLikeCredentialTests();
  });
});
