import { describe, it } from "vitest";

import {
  aggregateVocabularyIsSumAndAvg,
  bothEntriesDeclarePointKeyAndAggregate,
  byLocationDeclaresTheFourColumns,
  metricArmParsesWithCoverage,
  metricArmParsesWithoutCoverage,
  metricArmRefusesNegativeFresh,
  runDashboardAssetScopeFieldsTests,
  runDashboardBuilderTests,
  runDashboardGridTests,
  runDashboardWidgetPointDtoTests,
  runMetricCatalogDtoTests,
  runMetricCatalogTests,
  runStageAFieldsSurviveStrictCompositionTests,
  runStageAOptionalityTests,
  runStageASpecUnionCarriesTheNewFieldsTests,
  runStageATileBoundsTests,
  runStageAVocabulariesAreClosedTests,
  runWidgetPointCardinalityTests,
  waterBalanceDeclaresSevenColumnsAndPeriodParam,
  waterBalancePeriodVocabularyIsThreeTokens,
} from "./dashboard-builder.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.1a — the dashboard widget vocabulary and config union", () => {
  it("closes the vocabulary, discriminates the config, and narrows through the DTO", () => {
    runDashboardBuilderTests();
  });
});

describe("F3.1d Unit 2 — DASHBOARD_GRID wired into dashboardWidgetIdentitySchema", () => {
  it("reads the single-source grid bounds rather than a private 11/12/24", () => {
    runDashboardGridTests();
  });
});

describe("ADR 0047 Amendment 2 — per-type point cardinality", () => {
  it("covers every widget type and stays inside the global cap", () => {
    runWidgetPointCardinalityTests();
  });
});

/**
 * `F3.35` Stage C (ADR 0048 decisions 1, 2 and 4) — the metric catalog vocabulary and the two
 * response contracts a catalog binding adds.
 */
describe("F3.35 Stage C — the metric catalog vocabulary", () => {
  it("gives every key an entry, and every dataset distinct columns", () => {
    runMetricCatalogTests();
  });

  it("parses a binding and both value shapes, and closes the cell union", () => {
    runMetricCatalogDtoTests();
  });
});

describe("F3.1b — the widened point-binding DTO", () => {
  it("carries assetId/pointKey/unit, so a caller can build a pointRef", () => {
    runDashboardWidgetPointDtoTests();
  });
});

/**
 * `F3.35` Stage A (ADR 0048 decisions 3 and 6) — aggregation, the compare flag
 * and the tile's presentation fields.
 */
describe("F3.35 Stage A — aggregation and presentation on the tile and chart configs", () => {
  it("leaves every config stored before the change parsing unchanged", () => {
    runStageAOptionalityTests();
  });

  it("closes both new vocabularies at the contract, median and all", () => {
    runStageAVocabulariesAreClosedTests();
  });

  it("bounds the tile's window to the chart's own maximum, and its hint to one line", () => {
    runStageATileBoundsTests();
  });

  it("carries every new field through the .strict() composition apps/api performs", () => {
    runStageAFieldsSurviveStrictCompositionTests();
  });

  it("narrows the new fields through the discriminated spec union too", () => {
    runStageASpecUnionCarriesTheNewFieldsTests();
  });
});

describe("F3.2 — dashboardDto/dashboardSummaryDto gain the asset scope arm (ADR 0067)", () => {
  it("rejects a dashboard or summary row missing assetId; the summary alone also carries assetCode", () => {
    runDashboardAssetScopeFieldsTests();
  });
});

/**
 * `E4.2` / ADR 0072 decision 2 — two parameterised entries, and `coverage` / `currency`
 * optional on the shared metric arm. One claim per `it`.
 */
describe("E4.2 — the sustainability catalog entries and the roll-up fields", () => {
  it("parses a metric with neither coverage nor currency, as every older emitter sends", () => {
    metricArmParsesWithoutCoverage();
  });

  it("parses a metric carrying coverage { fresh, carrying } and a currency", () => {
    metricArmParsesWithCoverage();
  });

  it("refuses a negative fresh count", () => {
    metricArmRefusesNegativeFresh();
  });

  it("declares sustainability.by_location as a dataset with exactly the four benchmark columns", () => {
    byLocationDeclaresTheFourColumns();
  });

  it("declares params [pointKey, aggregate, balanceRole] on both entries and on no older one", () => {
    bothEntriesDeclarePointKeyAndAggregate();
  });

  it("closes the aggregate vocabulary to sum and avg", () => {
    aggregateVocabularyIsSumAndAvg();
  });
});

/** `E4.3` / ADR 0073 decision 3 — the `water.balance` dataset entry and its `period` param. */
describe("E4.3 — the water.balance catalog entry", () => {
  it("declares a dataset with the seven ADR-named columns and one param, period", () => {
    waterBalanceDeclaresSevenColumnsAndPeriodParam();
  });

  it("closes the period vocabulary to today, this_month and this_year", () => {
    waterBalancePeriodVocabularyIsThreeTokens();
  });
});
