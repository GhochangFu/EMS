import { describe, it } from "vitest";

import {
  runOptionalFieldsAreWrittenOnlyWhenGiven,
  runTheRegistersAreReparsed,
  runTheStoredConfigIsTheAdapters,
} from "./rtu-modbus-config.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the Modbus connection config a bind stores (plan T7.2)", () => {
  it("R1 — the stored config passes the adapter's strict schemas; registers copied", () => runTheStoredConfigIsTheAdapters());
  it("R2 — optional connection fields only when given; a null interval writes no key", () =>
    runOptionalFieldsAreWrittenOnlyWhenGiven());
  it("R3 — the profile's registers are re-parsed and a bad list is refused", () => runTheRegistersAreReparsed());
});
