import { describe, it } from "vitest";

import * as spec from "./mimic-symbol-libraries.query.spec";

/** `F3.32f` slice 3 U2 - Vitest entry point for the library list query parser (ADR 0014). */
describe("F3.32f - the mimic symbol library query", () => {
  it("the query refuses a non-uuid organization", () => spec.queryRefusesANonUuidOrganization());
});
