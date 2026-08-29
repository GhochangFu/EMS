import { describe, it } from "vitest";

import {
  runCellWidthTests,
  runClampWidgetTests,
  runDragToGridTests,
  runResizeToGridTests,
} from "./dashboard-grid-geometry.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("dashboard grid geometry", () => {
  it("computes a column's pixel width from the measured canvas", () => {
    runCellWidthTests();
  });

  it("clamps a widget onto the 12-column canvas through one choke point", () => {
    runClampWidgetTests();
  });

  it("converts a pointer drag to grid units and clamps at the edges", () => {
    runDragToGridTests();
  });

  it("converts a pointer resize to grid units and clamps at the minimums and edges", () => {
    runResizeToGridTests();
  });
});
