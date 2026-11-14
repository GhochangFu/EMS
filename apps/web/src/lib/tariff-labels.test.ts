import { describe, it } from "vitest";

import * as spec from "./tariff-labels.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F4.365 tariff labels", () => {
  for (const [name, fn] of Object.entries(spec)) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
