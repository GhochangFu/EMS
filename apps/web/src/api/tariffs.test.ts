import { afterEach, describe, it, vi } from "vitest";

import * as spec from "./tariffs.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). One `it()` per
 * claim; the project's `node` default.
 */
describe("F4.365 tariff web clients", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length < 6) {
      throw new Error(`expected at least 6 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, async () => {
      await (fn as () => void | Promise<void>)();
    });
  }
});
