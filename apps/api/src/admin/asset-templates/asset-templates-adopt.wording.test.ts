import { describe, it } from "vitest";

import {
  theCalcGateSpeaksOfAStandalonePoint,
  theContentGuardSaysAdopt,
  theInsertNetNamesTheAdoption,
  theMetadataGateGivesTheAdoptRemedy,
  theRuleBackstopSaysNothingWasWritten,
} from "./asset-templates-adopt.wording.spec";

/** `F4.312` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.312 — adoption's sentences are adoption's", () => {
  it("calls the row a standalone calculated point, remedied by adopting", () =>
    theCalcGateSpeaksOfAStandalonePoint());
  it("gives the metadata refusal the adopt remedy", () => theMetadataGateGivesTheAdoptRemedy());
  it("names the adoption in the insert net's 409", () => theInsertNetNamesTheAdoption());
  it("says nothing was written on a rule collision", () => theRuleBackstopSaysNothingWasWritten());
  it("says adopt in the content guard's 409", () => theContentGuardSaysAdopt());
});
