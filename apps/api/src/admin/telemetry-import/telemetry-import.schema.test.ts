import { describe, it } from "vitest";

import { runTelemetryImportSchemaTests } from "./telemetry-import.schema.spec";

/**
 * Vitest entry point. Assertions live in the sibling `.spec.ts` module
 * (ADR 0014). No database dependency — pure Zod parsing.
 */
describe("telemetryImportOptionsBodySchema", () => {
  it("defaults sourceKind/conflictPolicy and rejects invalid or unknown fields", () => {
    runTelemetryImportSchemaTests();
  });
});
