import { describe, it } from "vitest";

import * as spec from "./mimic-editor.flags.spec";

/** Vitest entry point — one `it()` per exported `run*` claim (ADR 0014). */
describe("mimic editor save body carries the layout flags (F3.74)", () => {
  for (const [name, fn] of Object.entries(spec).filter(([n]) => n.startsWith("run"))) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
