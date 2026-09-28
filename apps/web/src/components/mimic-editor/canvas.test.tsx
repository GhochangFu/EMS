// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import * as spec from "./canvas.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). One `it()` per claim. */
describe("F3.32c mimic editor canvas", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length < 13) {
      throw new Error(`expected at least 13 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
