import { describe, it } from "vitest";

import {
  runDashboardsSchemaGridBoundsTests,
  runDashboardsSchemaSourceShapeTests,
  runDashboardsSchemaTests,
} from "./dashboards.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.1b — dashboard request bodies", () => {
  it("refuses unknown keys, both scope columns, over-cardinality, inverted ranges, and duplicate bindings", () => {
    runDashboardsSchemaTests();
  });
});

describe("F3.1d Unit 2 — DASHBOARD_GRID wired into widgetIdentityWriteFields and eachWidgetFitsTheGrid", () => {
  it("reads the single-source grid bounds rather than a private 11/12/24", () => {
    runDashboardsSchemaGridBoundsTests();
  });
});

describe("F3.35 Stage C — a widget binds only a catalog shape it can draw", () => {
  it("refuses a dataset entry on a value_tile, and still accepts the metric one", () => {
    runDashboardsSchemaSourceShapeTests();
  });
});
