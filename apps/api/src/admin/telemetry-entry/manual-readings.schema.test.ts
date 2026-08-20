import { describe, it } from "vitest";

import {
  runManualReadingsBodySchemaTests,
  runManualReadingsSchemaTests,
} from "./manual-readings.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("telemetry-entry manual-readings response envelope schema", () => {
  it("parses the F1.8/F1.9 write-response envelope and matches WriteReadingsOutput", () => {
    runManualReadingsSchemaTests();
  });
});

describe("telemetry-entry manual-readings request body schema", () => {
  it("applies defaults, enforces .strict(), and bounds/validates rows as documented", () => {
    runManualReadingsBodySchemaTests();
  });
});
