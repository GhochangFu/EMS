import { afterEach, describe, it, vi } from "vitest";

import { a409IsAnApiErrorWithItsStatus, anEmpty204Resolves } from "./dashboard-templates.delete.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). No
 * `@vitest-environment` docblock: this file wants the project's `node` default.
 */
describe("dashboard template Delete draft client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("an empty 204 resolves", async () => {
    await anEmpty204Resolves();
  });

  it("a 409 is an ApiError with its status", async () => {
    await a409IsAnApiErrorWithItsStatus();
  });
});
