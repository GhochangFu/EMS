import { afterEach, describe, it, vi } from "vitest";

import * as spec from "./mimic-layouts.preview.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). One `it()` per
 * claim. No `@vitest-environment` docblock: this file wants the project's `node` default.
 */
describe("F4.308 mimic layout preview web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length < 7) {
      throw new Error(`expected at least 7 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, async () => {
      await (fn as () => Promise<void>)();
    });
  }
});
