import { describe, it } from "vitest";

import { runIngestDbGateTests } from "./integration-db-gate.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("ingest integration database gate", () => {
  it("skips locally, refuses in CI, and derives the fleet role from the owner URL", () => {
    runIngestDbGateTests();
  });
});
