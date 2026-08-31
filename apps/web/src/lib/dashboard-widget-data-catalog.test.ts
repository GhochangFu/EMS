import { describe, it } from "vitest";

import {
  runCatalogBindingSelectionTests,
  runCatalogBoundTileIsNotEmptyTests,
  runCatalogGateTests,
  runCatalogStalenessTests,
  runDatasetOnATileRendersNoValueTests,
} from "./dashboard-widget-data-catalog.spec";

/** `F3.35` Stage C — Vitest wrapper for the catalog data path (ADR 0014). */
describe("F3.35 Stage C — a catalog-bound widget", () => {
  it("is readable rather than empty, and still leaves an unbound widget empty", () => {
    runCatalogBoundTileIsNotEmptyTests();
  });

  it("reads the binding with the lowest stored sortOrder, and tolerates an unanswered one", () => {
    runCatalogBindingSelectionTests();
  });

  it("renders no value for a dataset resolved onto a single-number widget", () => {
    runDatasetOnATileRendersNoValueTests();
  });
});

describe("F3.35 Stage C — catalog staleness", () => {
  it("ages against resolvedAt on the refresh window, not against FRESH_MS", () => {
    runCatalogStalenessTests();
  });
});

describe("F3.35 Stage C — the catalog read gate", () => {
  it("stays off for every dashboard that binds no catalog entry", () => {
    runCatalogGateTests();
  });
});
