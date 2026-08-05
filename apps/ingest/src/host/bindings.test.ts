import { describe, it } from "vitest";

import { runBindingsTests } from "./bindings.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host binding plan", () => {
  it("resolves protocols, shims MQTT and groups endpoints per ADR 0016 §3", () => {
    runBindingsTests();
  });
});
