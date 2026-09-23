import { describe, it } from "vitest";

import {
  byLocationAcceptsATable,
  byLocationRefusedOnAValueTile,
  byLocationRefusesEmptyParams,
  olderEntryStillRefusesPointKey,
  runDashboardsSchemaGridBoundsTests,
  runDashboardsSchemaSourceShapeTests,
  runDashboardsSchemaTests,
  runListDashboardsQueryTests,
  sustainabilityTotalAcceptsPointKeyAndAggregate,
  sustainabilityTotalAcceptsABalanceRole,
  byLocationAcceptsABalanceRole,
  sustainabilityTotalRefusesAnEmptyBalanceRole,
  sustainabilityTotalRefusesALongBalanceRole,
  sustainabilityTotalRefusesACharsetViolation,
  sustainabilityTotalRefusesALongPointKey,
  sustainabilityTotalRefusesAnExtraField,
  sustainabilityTotalRefusesMissingAggregate,
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

describe("F3.31 Task 3 — GET /dashboards?assetId= (ADR 0068 decision 4)", () => {
  it("accepts a uuid assetId and keeps it, accepts an empty query, refuses a non-uuid", () => {
    runListDashboardsQueryTests();
  });
});

/** `E4.2` / ADR 0072 decision 2 — `{ pointKey, aggregate }` on the two sustainability entries. */
describe("E4.2 — the sustainability entries' write-side params", () => {
  it("accepts sustainability.total { pointKey: kl_today, aggregate: sum } on a value_tile", () => {
    sustainabilityTotalAcceptsPointKeyAndAggregate();
  });

  it("refuses a missing aggregate with one issue at params.aggregate, prefixed by the entry key", () => {
    sustainabilityTotalRefusesMissingAggregate();
  });

  it("refuses an undeclared `period` field — the entry is strict", () => {
    sustainabilityTotalRefusesAnExtraField();
  });

  it("refuses a 65-character pointKey", () => {
    sustainabilityTotalRefusesALongPointKey();
  });

  it("refuses a pointKey outside the catalog-code charset", () => {
    sustainabilityTotalRefusesACharsetViolation();
  });

  it("refuses params: {} on sustainability.by_location", () => {
    byLocationRefusesEmptyParams();
  });

  it("accepts a table binding sustainability.by_location", () => {
    byLocationAcceptsATable();
  });

  it("refuses sustainability.by_location on a value_tile with the shape message", () => {
    byLocationRefusedOnAValueTile();
  });

  it("still refuses params on alarms.active.count — the fields did not leak to an older entry", () => {
    olderEntryStillRefusesPointKey();
  });
});

/** `E4.3` / ADR 0073 decision 2 — the optional `balanceRole` on the two sustainability entries. */
describe("E4.3 — balanceRole on the sustainability entries' write-side params", () => {
  it("accepts balanceRole: intake on sustainability.total", () => {
    sustainabilityTotalAcceptsABalanceRole();
  });

  it("accepts balanceRole: intake on sustainability.by_location", () => {
    byLocationAcceptsABalanceRole();
  });

  it("refuses an empty balanceRole at the field", () => {
    sustainabilityTotalRefusesAnEmptyBalanceRole();
  });

  it("refuses a 65-character balanceRole", () => {
    sustainabilityTotalRefusesALongBalanceRole();
  });
});
