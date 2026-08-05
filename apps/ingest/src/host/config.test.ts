import { describe, it } from "vitest";

import { runHostConfigTests } from "./config.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host config", () => {
  it("defaults NOTIFY off and refuses ambiguous values", () => {
    runHostConfigTests();
  });
});
