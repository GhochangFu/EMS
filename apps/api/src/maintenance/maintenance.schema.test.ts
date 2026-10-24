import { describe, it } from "vitest";

import {
  includeInactiveReadsTheStringFalseAsFalse,
  includeInactiveReadsTheStringTrueAsTrue,
  runMaintenanceSchemaTests,
} from "./maintenance.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("maintenance schema", () => {
  it("keeps the priority filter derived from the exported enum", () => {
    runMaintenanceSchemaTests();
  });
  it("F4.281: includeInactive defaults to false and reads ?includeInactive=false as false", () =>
    includeInactiveReadsTheStringFalseAsFalse());
  it("F4.281: ?includeInactive=true lists inactive schedules too", () => includeInactiveReadsTheStringTrueAsTrue());
});
