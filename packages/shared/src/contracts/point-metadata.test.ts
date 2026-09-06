import { describe, it } from "vitest";

import {
  runDtoSpreadTests,
  runPointMetadataShapeTests,
  runQualityPolicyVocabularyTests,
  runStockShapeTests,
} from "./point-metadata.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.7 — point metadata on the read side (ADR 0056 decisions 1, 3)", () => {
  it("builds the quality-policy enum from the host's QUALITY_POLICIES", () => {
    runQualityPolicyVocabularyTests();
  });

  it("names exactly five nullable fields with no read-side bound", () => {
    runPointMetadataShapeTests();
  });

  it("spreads the five into the asset-point and template-point DTOs as required keys", () => {
    runDtoSpreadTests();
  });

  it("carries the five as optional keys on the stock write shape", () => {
    runStockShapeTests();
  });
});
