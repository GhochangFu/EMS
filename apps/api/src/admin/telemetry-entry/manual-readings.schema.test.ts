import { describe, it } from "vitest";

import {
  runManualReadingsBodySchemaTests,
  runManualReadingsSchemaTests,
  runTelemetryEntryRowSchemaStrictnessTests,
} from "./manual-readings.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("telemetry-entry manual-readings response envelope schema", () => {
  it("parses the F1.8/F1.9 write-response envelope and matches WriteReadingsOutput", () => {
    runManualReadingsSchemaTests();
  });
});

describe("telemetryEntryRowSchema", () => {
  it("rejects a row carrying an unknown key instead of silently stripping it", () => {
    runTelemetryEntryRowSchemaStrictnessTests();
  });
});

describe("telemetry-entry manual-readings request body schema", () => {
  it("applies defaults, enforces .strict(), and bounds/validates rows as documented", () => {
    runManualReadingsBodySchemaTests();
  });
});
