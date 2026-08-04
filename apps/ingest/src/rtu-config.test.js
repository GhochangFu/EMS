import { describe, it } from "vitest";

import { runRtuConfigTests } from "./rtu-config.js";

/**
 * Vitest entry point. Unlike the `.spec.ts` modules, `rtu-config.js` is a
 * production module that also exports its own checks, so its assertions stay
 * where they are (ADR 0014).
 */
describe("rtu-config", () => {
  it("resolves MQTT connection settings from env fallbacks", () => {
    runRtuConfigTests();
  });
});
