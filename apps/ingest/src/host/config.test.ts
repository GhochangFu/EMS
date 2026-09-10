import { describe, it } from "vitest";

import {
  runCredentialKeyOpenWindowAcceptedTests,
  runCredentialKeyShortPreviousRefusedTests,
  runCredentialKeyUnsetTests,
  runCredentialKeyVersionZeroRefusedTests,
  runHostConfigTests,
} from "./config.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host config", () => {
  it("defaults NOTIFY off and refuses ambiguous values", () => {
    runHostConfigTests();
  });

  it("refuses to boot on a previous key at version 0 (ADR 0062 decision 5)", () => {
    runCredentialKeyVersionZeroRefusedTests();
  });

  it("boots on an open rotation window and reports the key configured", () => {
    runCredentialKeyOpenWindowAcceptedTests();
  });

  it("boots with no key configured, and says it is unconfigured", () => {
    runCredentialKeyUnsetTests();
  });

  it("refuses to boot on a previous key that is not 32 bytes (Amendment 1)", () => {
    runCredentialKeyShortPreviousRefusedTests();
  });
});
