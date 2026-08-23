import { describe, it } from "vitest";

import { runChannelsServiceTests } from "./channels.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 channels service", () => {
  it("answers constraint violations with 409/400 and keeps readiness honest", async () => {
    await runChannelsServiceTests();
  });
});
