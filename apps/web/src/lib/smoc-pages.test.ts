import { describe, it } from "vitest";

import { runP1 } from "./smoc-pages.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("smoc-pages", () => {
  it("P1 — the seven SMOC pages, labels and paths in the shell's order", () => {
    runP1();
  });
});
