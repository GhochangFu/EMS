// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import * as spec from "./point-key-states-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2). One `it()` per claim.
 */
describe("F4.309 State Labels admin page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length < 24) {
      throw new Error(`expected at least 24 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, async () => {
      await (fn as () => Promise<void>)();
    });
  }
});
