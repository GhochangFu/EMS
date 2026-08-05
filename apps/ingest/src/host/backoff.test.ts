import { describe, it } from "vitest";

import { runBackoffTests } from "./backoff.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("reconnect backoff", () => {
  it("implements the ADR 0016 §5 policy exactly", () => {
    runBackoffTests();
  });
});
