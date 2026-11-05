// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import * as spec from "./use-site-live-readings.enabled.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.308 useSiteLiveReadings enabled", () => {
  afterEach(() => {
    cleanup();
  });

  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length < 3) {
      throw new Error(`expected at least 3 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
