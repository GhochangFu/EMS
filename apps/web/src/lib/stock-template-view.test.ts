import { describe, it } from "vitest";

import {
  runContentAndPointsSurviveTests,
  runFindStockEntryTests,
  runMetaBridgeTests,
  runNullDescriptionSurvivesTests,
  runParsesAsAdminTemplateTests,
  runSentinelIdTests,
  runCoverageRatioIsCarriedThroughTests,
  runStockRatioSurvivesTheGridRoundTripTests,
  runStatusIsReadOnlyTests,
  runVersionIsZeroTests,
} from "./stock-template-view.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("stock template view", () => {
  it("reads as not editable, so every formula editor renders read-only", () => {
    runStatusIsReadOnlyTests();
  });

  it("is a valid AdminAssetTemplateDto at runtime", () => {
    runParsesAsAdminTemplateTests();
  });

  it("carries content and points through by value", () => {
    runContentAndPointsSurviveTests();
  });

  it("carries minCoverageRatio through instead of hardcoding null", () => {
    runCoverageRatioIsCarriedThroughTests();
  });

  it("keeps minCoverageRatio across the whole stock-to-payload path", () => {
    runStockRatioSurvivesTheGridRoundTripTests();
  });

  it("bridges point meta from optional to nullable", () => {
    runMetaBridgeTests();
  });

  it("keeps a null description null", () => {
    runNullDescriptionSurvivesTests();
  });

  it("uses a sentinel id that is not a uuid", () => {
    runSentinelIdTests();
  });

  it("has row version 0 and carries the stock version separately", () => {
    runVersionIsZeroTests();
  });

  it("finds a stock entry by code", () => {
    runFindStockEntryTests();
  });
});
