import { describe, it } from "vitest";

import {
  runCanApplyIsTheServersVerdictTests,
  runDeltaLineTests,
  runMigrateActionStateTests,
  runMigrationTargetTests,
  runMixedSourceVersionTests,
  runPartitionSelectionTests,
  runRefusalsAreVerbatimTests,
  runVersionLabelTests,
} from "./template-version-migration.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("F2.6 — template version migration view rules", () => {
  it("distinguishes the four reasons Migrate is unavailable", () => {
    runMigrateActionStateTests();
  });

  it("takes canApply from the server and never recomputes it from refusals", () => {
    runCanApplyIsTheServersVerdictTests();
  });

  it("renders the API's refusal sentences verbatim", () => {
    runRefusalsAreVerbatimTests();
  });

  it("reports every source version a mixed selection spans", () => {
    runMixedSourceVersionTests();
  });

  it("separates the assets that will move from those already on target", () => {
    runPartitionSelectionTests();
  });

  it("flattens a delta into lines, refusing changes first", () => {
    runDeltaLineTests();
  });

  it("treats only a published version as a migration target", () => {
    runMigrationTargetTests();
  });

  it("says whether a version is still in service", () => {
    runVersionLabelTests();
  });
});
