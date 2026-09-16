import { describe, it } from "vitest";

import {
  assertC1,
  assertC2,
  assertC3,
  assertC4,
  assertC5,
  STOCK_CATALOG_FOR_DASHBOARD_TESTS,
} from "./stock-catalog-dashboards.spec";

/**
 * Vitest entry point for `stock-catalog-dashboards.spec.ts` — assertions live
 * in the `.spec` sibling (ADR 0014). A name-sibling wrapper, not a runner
 * folded into `stock-catalog.test.ts`: `tests/repo-invariants.test.ts` pairs a
 * spec with its wrapper by name, and a spec executed from a differently-named
 * wrapper is absent from coverage even though it still runs (memory:
 * `f2.12` was red for four commits on exactly this).
 *
 * C5 runs first: it is the positive control on the mechanism C2–C4 all use
 * (`assertDashboardPointKeysResolve`), so a reader sees that the checker can
 * fail before trusting the 27 green passes below it.
 */
describe("stock asset-template catalog — the dashboards build-time gate (F3.2 Task 8)", () => {
  it("C5 — a synthetic entry with an undeclared featured key is refused (the checker's own control)", () => {
    assertC5();
  });

  it("C1 — every catalog entry carries content.dashboards.overview", () => {
    assertC1(STOCK_CATALOG_FOR_DASHBOARD_TESTS);
  });

  it("C2 — every featured key and widget pointKeys entry is a declared measured, non-manual point", () => {
    assertC2(STOCK_CATALOG_FOR_DASHBOARD_TESTS);
  });

  it("C3 — exactly one chart per view; tile count matches featured.length; tile i binds featured[i]", () => {
    assertC3(STOCK_CATALOG_FOR_DASHBOARD_TESTS);
  });

  it("C4 — no two widgets on one view overlap on the grid", () => {
    assertC4(STOCK_CATALOG_FOR_DASHBOARD_TESTS);
  });
});
