import { describe, it } from "vitest";

import {
  runBindingSurvivesARegeneratedSourceIdTests,
  runCatalogBindingSelectionTests,
  runCatalogBoundTileIsNotEmptyTests,
  runCatalogGateTests,
  runCatalogStalenessTests,
  runDatasetBindingProducesRowsTests,
  runDatasetOnATileRendersNoValueTests,
  runUnansweredDatasetKeepsItsHeaderTests,
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

  it("still resolves after an unrelated save regenerated the binding's row id", () => {
    runBindingSurvivesARegeneratedSourceIdTests();
  });
});

describe("F3.35 Stage B — a table bound to a dataset", () => {
  it("reaches the renderer as rows and columns, not as a number", () => {
    runDatasetBindingProducesRowsTests();
  });

  it("renders its declared header before the first resolve answers", () => {
    runUnansweredDatasetKeepsItsHeaderTests();
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
