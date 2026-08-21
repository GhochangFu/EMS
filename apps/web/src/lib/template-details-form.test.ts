import { describe, it } from "vitest";

import {
  runBlankFieldTests,
  runDescriptionThreeStateTests,
  runLengthLimitTests,
  runOnlyChangedFieldsTests,
  runSeedTests,
} from "./template-details-form.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template details form", () => {
  it("seeds from the loaded template, with an absent description as empty text", () => {
    runSeedTests();
  });

  it("refuses a blank name, asset type or domain before the server does", () => {
    runBlankFieldTests();
  });

  it("mirrors the schema's length caps", () => {
    runLengthLimitTests();
  });

  it("sends only the fields that changed", () => {
    runOnlyChangedFieldsTests();
  });

  it("distinguishes leaving, setting and clearing the description", () => {
    runDescriptionThreeStateTests();
  });
});
