import { describe, it } from "vitest";

import {
  aBatchOfTwentyFiveReachesTheService,
  aBatchOfTwentySixIsABadRequest,
  aBatchWithANullFormulaNamesTheField,
} from "./calc-point-batch.controller.spec";

/** `F4.311` PR 2 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). No database. */
describe("F4.311 — POST /admin/calc-points/batch parses its body (ADR 0109 ruling 4)", () => {
  it("passes a batch of 25 to the service", () => aBatchOfTwentyFiveReachesTheService());
  it("refuses a batch of 26 at the schema", () => aBatchOfTwentySixIsABadRequest());
  it("names formula when it is null", () => aBatchWithANullFormulaNamesTheField());
});
