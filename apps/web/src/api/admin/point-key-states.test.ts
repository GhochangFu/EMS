import { afterEach, describe, it, vi } from "vitest";

import * as spec from "./point-key-states.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). One `it()` per
 * claim. No `@vitest-environment` docblock: this file wants the project's `node` default.
 */
describe("F4.309 state-labels web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length < 12) {
      throw new Error(`expected at least 12 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, async () => {
      await (fn as () => void | Promise<void>)();
    });
  }
});
