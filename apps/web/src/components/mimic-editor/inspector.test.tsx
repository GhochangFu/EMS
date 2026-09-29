// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import * as spec from "./inspector.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). One `it()` per claim. */
describe("F3.32c mimic editor inspector", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length < 11) {
      throw new Error(`expected at least 11 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, async () => {
      await (fn as () => void | Promise<void>)();
    });
  }
});
