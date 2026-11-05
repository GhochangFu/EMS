// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import * as spec from "./mimic-preview-canvas.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). One `it()` per
 * claim; the `*Fixture` builders and the `PREVIEW_*` ids are shared, not claims.
 */
describe("F4.308 mimic preview canvas", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const cases = Object.entries(spec).filter(([name]) => !name.endsWith("Fixture") && !name.startsWith("PREVIEW_"));

  it("has its claims", () => {
    if (cases.length < 17) {
      throw new Error(`expected at least 17 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
