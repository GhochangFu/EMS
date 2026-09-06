import { describe, it } from "vitest";

import {
  runMetadataTests,
  runNormaliserTests,
  runNormaliserWriteTests,
} from "./normaliser.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host normaliser", () => {
  it("resolves samples to point_values rows without a database", () => {
    runNormaliserTests();
  });

  it("applies quality policy, scale, finite and range per target in ADR 0056 decision 4's order", () => {
    runMetadataTests();
  });

  it("writes and notifies exactly as the ADR 0016 §6 parallel run requires", async () => {
    await runNormaliserWriteTests();
  });
});
