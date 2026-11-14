import { describe, it } from "vitest";

import {
  assertAMissingSheetIsNamed,
  assertASheetAtTheLimitParses,
  assertASheetOverTheLimitIsRefused,
  assertAWideDeclaredRangeIsNotDensified,
} from "./rate-chart-read.spec";

/** `F4.365` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.365 — the Rate Chart read bounds", () => {
  it("parses a sheet at the row limit", () => assertASheetAtTheLimitParses());
  it("refuses a sheet one row over the limit instead of cutting it", () => assertASheetOverTheLimitIsRefused());
  it("reads a declared A1:XFD range across 22 columns only", () => assertAWideDeclaredRangeIsNotDensified());
  it("names a missing Rate Chart sheet", () => assertAMissingSheetIsNamed());
}, 60_000);
