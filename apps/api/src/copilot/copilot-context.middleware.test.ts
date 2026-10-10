import { describe, it } from "vitest";

import { aHandlerAfterNextSeesTheStore, eachRequestStartsWithNoChange } from "./copilot-context.middleware.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 — the copilot request context middleware", () => {
  it("lets a handler awaited after next() see the store", () => aHandlerAfterNextSeesTheStore());
  it("starts each request with no change", () => eachRequestStartsWithNoChange());
});
