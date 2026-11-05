// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import * as spec from "./mimic-layout-editor-page.preview.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). One `it()` per claim. */
describe("F4.308 mimic layout editor — Preview with site", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length < 18) {
      throw new Error(`expected at least 18 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, async () => {
      await (fn as () => Promise<void>)();
    });
  }
});
