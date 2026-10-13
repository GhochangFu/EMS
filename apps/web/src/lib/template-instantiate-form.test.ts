import { describe, it } from "vitest";

import {
  runBlankRowTests,
  runMissingVariablesMessageTests,
  runMissingVariablesTests,
  runNoTargetTests,
  runPatternsCarryingVariablesTests,
  runRowsOfAssetsTests,
  runRtuWinsTests,
  runSingleTargetTests,
  runSiteNameRoundTripTests,
  runTargetOfLocationAndNoneTests,
  runTargetOfRtuWinsTests,
  runTemplateVariablesTests,
  runTrimAndFallbackTests,
  runVarsPayloadTests,
} from "./template-instantiate-form.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template instantiate form", () => {
  it("sends the RTU, never the location, when the picker set both", () => {
    runRtuWinsTests();
  });

  it("sends whichever id was chosen alone", () => {
    runSingleTargetTests();
  });

  it("refuses with a message when no target is chosen", () => {
    runNoTargetTests();
  });

  it("drops the blank rows the dialog leaves behind", () => {
    runBlankRowTests();
  });

  it("trims, and names an unnamed asset after its code", () => {
    runTrimAndFallbackTests();
  });

  it("lists the measured points' pattern variables, minus asset_code", () => {
    runTemplateVariablesTests();
  });

  it("carries sourceDataKeyVars only when a var survives trimming", () => {
    runVarsPayloadTests();
  });

  it("names a named row's blank required variable", () => {
    runMissingVariablesTests();
  });

  it("names only the patterns that carry a variable, not asset_code alone", () => {
    runPatternsCarryingVariablesTests();
  });

  it("gives the RTU alone as the target when both ids are set (F4.254 PR 3)", () => {
    runTargetOfRtuWinsTests();
  });

  it("gives a location alone, and null for no choice (F4.254 PR 3)", () => {
    runTargetOfLocationAndNoneTests();
  });

  it("turns a filled body's assets back into editor rows (F4.254 PR 3)", () => {
    runRowsOfAssetsTests();
  });

  it("names each row and variable a submit lacks (F4.254 PR 3)", () => {
    runMissingVariablesMessageTests();
  });

  it("keeps a filled siteName on the row and sends it (F4.254 PR 3)", () => {
    runSiteNameRoundTripTests();
  });
});
