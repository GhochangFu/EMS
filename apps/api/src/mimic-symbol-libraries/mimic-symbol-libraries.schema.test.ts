import { describe, it } from "vitest";

import * as spec from "./mimic-symbol-libraries.schema.spec";

/** `F3.32f` slice 3 U2 — Vitest entry point for the mimic symbol library request shapes. Assertions
 * live in the sibling `.spec` (ADR 0014); one `it()` per claim. */
describe("F3.32f — the mimic symbol library request shapes", () => {
  it("accepts a valid create body", () => spec.acceptsAValidCreateBody());
  it("defaults an absent attribution to empty", () => spec.defaultsAnAbsentAttributionToEmpty());
  it("create refuses an unknown key", () => spec.createRefusesAnUnknownKey());
  it("create refuses an uppercase code", () => spec.createRefusesAnUppercaseCode());
  it("create refuses a code of 28 characters", () => spec.createRefusesACodeOf28Characters());
  it("create refuses an org.-prefixed code", () => spec.createRefusesAnOrgPrefixedCode());
  it("create refuses an empty label", () => spec.createRefusesAnEmptyLabel());
  it("create refuses an unknown style", () => spec.createRefusesAnUnknownStyle());
  it("create refuses a javascript: source URL", () => spec.createRefusesAJavascriptSourceUrl());
  it("create refuses a missing organization", () => spec.createRefusesAMissingOrganization());
  it("a library patch refuses an empty body", () => spec.libraryPatchRefusesAnEmptyBody());
  it("a library patch accepts active alone", () => spec.libraryPatchAcceptsActiveAlone());
  it("a library patch refuses the code", () => spec.libraryPatchRefusesTheCode());
  it("a symbol patch refuses an empty body", () => spec.symbolPatchRefusesAnEmptyBody());
  it("a symbol patch refuses an unknown group", () => spec.symbolPatchRefusesAnUnknownGroup());
  it("a symbol patch refuses the shapes", () => spec.symbolPatchRefusesTheShapes());
  it("the setting refuses a missing enabled", () => spec.settingRefusesAMissingEnabled());
  it("the setting refuses an unknown key", () => spec.settingRefusesAnUnknownKey());
  it("the query refuses a non-uuid organization", () => spec.queryRefusesANonUuidOrganization());
  it("the upload fields refuse an unknown field", () => spec.uploadFieldsRefuseAnUnknownField());
  it("the upload fields refuse a name outside the grammar", () => spec.uploadFieldsRefuseANameOutsideTheGrammar());
  it("the upload fields accept blank form fields", () => spec.uploadFieldsAcceptBlankFormFields());
  it("the filename refuses a control character", () => spec.filenameRefusesAControlCharacter());
});
