import { describe, it } from "vitest";

import {
  runBlankRowTests,
  runCountMatchesPayloadTests,
  runMissingVariablesTests,
  runNoTargetTests,
  runPatternsCarryingVariablesTests,
  runRtuWinsTests,
  runSingleTargetTests,
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

  it("builds exactly as many assets as the button promised", () => {
    runCountMatchesPayloadTests();
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
});
