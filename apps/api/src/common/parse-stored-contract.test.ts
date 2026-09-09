import { describe, it } from "vitest";

import {
  assertAContractViolationThrowsAServerFaultAndNotAZodError,
  assertANonZodThrowPassesThroughUnchanged,
  assertAValidStoredValueIsReturned,
  assertTheLogCarriesTheContextAndNoRowData,
  assertTheMessageNamesTheContextAndEchoesNothingFromTheValue,
} from "./parse-stored-contract.spec";

/** `F4.108` / ADR 0060 ruling 2 — Vitest entry point (§4.6). */
describe("ADR 0060 ruling 2 — a stored row that breaks its contract is a server fault", () => {
  it("returns the parsed value when the stored row is valid", () => {
    assertAValidStoredValueIsReturned();
  });

  it("throws a 500 HttpException rather than a bare ZodError", () => {
    assertAContractViolationThrowsAServerFaultAndNotAZodError();
  });

  it("names the context in the body and echoes nothing from the row", () => {
    assertTheMessageNamesTheContextAndEchoesNothingFromTheValue();
  });

  it("logs the context and the issue codes, and no row data", () => {
    assertTheLogCarriesTheContextAndNoRowData();
  });

  it("re-throws a non-Zod failure unchanged", () => {
    assertANonZodThrowPassesThroughUnchanged();
  });
});
