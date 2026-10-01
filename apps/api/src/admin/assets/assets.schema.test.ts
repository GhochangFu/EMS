import { describe, it } from "vitest";

import * as spec from "./assets.schema.spec";

/** Vitest entry point — one `it()` per exported `run*` claim (ADR 0014). */
describe("asset body rating and tripCause (F3.74)", () => {
  for (const [name, fn] of Object.entries(spec).filter(([n]) => n.startsWith("run"))) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
