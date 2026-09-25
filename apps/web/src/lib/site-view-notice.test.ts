import { describe, it } from "vitest";

import { runN1, runN2, runN3, runN4, runN5 } from "./site-view-notice.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("site-view-notice", () => {
  it("N1 — the three fail-safe codes map to three distinct, non-empty strings", () => {
    runN1();
  });

  it("N2 — a null notice maps to null", () => {
    runN2();
  });

  it("N3 — dashboard_removed says the dashboard has been removed", () => {
    runN3();
  });

  it("N4 — dashboard_out_of_scope says the dashboard is no longer in the access scope", () => {
    runN4();
  });

  it("N5 — builtin_unknown names the built-in view", () => {
    runN5();
  });
});
