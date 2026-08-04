import { describe, it } from "vitest";

import { runOperationsWriteTests } from "./operations-write.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("operations-write", () => {
  it("enforces the ADR 0017 write matrix", () => {
    runOperationsWriteTests();
  });
});
