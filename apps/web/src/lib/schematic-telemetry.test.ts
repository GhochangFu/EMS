import { describe, it } from "vitest";

import {
  runProvenanceHelperTests,
  runSchematicTelemetryTests,
} from "./schematic-telemetry.spec";

/** Vitest entry point — see `apps/api/src/admin/admin.schema.test.ts` (ADR 0014). */
describe("schematic-telemetry", () => {
  it("clamps future timestamps and derives status from freshness", () => {
    runSchematicTelemetryTests();
  });

  it("gates each value by its own asset's clock (ADR 0028)", () => {
    runProvenanceHelperTests();
  });
});
