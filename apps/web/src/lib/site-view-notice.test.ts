import { describe, it } from "vitest";

import { runN1, runN2 } from "./site-view-notice.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("site-view-notice", () => {
  it("N1 — the three fail-safe codes map to three distinct, non-empty strings", () => {
    runN1();
  });

  it("N2 — a null notice maps to null", () => {
    runN2();
  });
});
