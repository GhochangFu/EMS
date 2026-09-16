import { describe, it } from "vitest";

import {
  runDefaultDashboardsBackfillOutcomeTests,
  runDefaultDashboardsBackfillResultDtoTests,
  runInstantiatedDashboardDtoTests,
} from "./asset-dashboards.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.2 — per-asset default-dashboard instantiation and backfill reports (ADR 0067)", () => {
  it("accepts a full instantiated-dashboard report and rejects one missing omittedFeatured", () => {
    runInstantiatedDashboardDtoTests();
  });

  it("closes the backfill outcome vocabulary to created | skipped_existing", () => {
    runDefaultDashboardsBackfillOutcomeTests();
  });

  it("rejects a backfill result or asset entry missing a required field", () => {
    runDefaultDashboardsBackfillResultDtoTests();
  });
});
