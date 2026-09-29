// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import * as spec from "./mimic-layout-editor-page.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). One `it()` per claim. */
describe("F3.32c mimic layout editor page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length < 23) {
      throw new Error(`expected at least 23 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, async () => {
      await (fn as () => Promise<void>)();
    });
  }
});
