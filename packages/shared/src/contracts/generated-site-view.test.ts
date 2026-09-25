import { describe, it } from "vitest";

import {
  runAdminPointKeyRequiresHeadlineRankTest,
  runFractionalHeadlineRankTest,
  runStaleFreshnessAcceptedTest,
  runTwoDomainPayloadTest,
  runUnknownFreshnessTest,
} from "./generated-site-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.68 — the generated site view contracts (ADR 0076 decision 7)", () => {
  it("C1 — accepts a two-domain payload", () => {
    runTwoDomainPayloadTest();
  });

  it("C2 — rejects an asset with an unknown freshness value (old)", () => {
    runUnknownFreshnessTest();
  });

  it("C2b — accepts freshness: stale", () => {
    runStaleFreshnessAcceptedTest();
  });

  it("C3 — rejects a point with a non-integer headlineRank (1.5)", () => {
    runFractionalHeadlineRankTest();
  });

  it("C4 — adminPointKeyDtoSchema rejects a row with no headlineRank", () => {
    runAdminPointKeyRequiresHeadlineRankTest();
  });
});
