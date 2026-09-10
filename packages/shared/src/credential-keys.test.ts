import { describe, it } from "vitest";

import {
  runCurrentKeyLengthTests,
  runCurrentKeyPositiveControlTests,
  runEmptyStringIsUnsetTests,
  runKeyForCurrentVersionTests,
  runKeyForPreviousVersionTests,
  runLoadedKeyVersionsTests,
  runNoPreviousKeyTests,
  runNonIntegerVersionTableTests,
  runPreviousKeyAndVersionTests,
  runPreviousKeyLengthTests,
  runPreviousWithoutCurrentTests,
  runUnconfiguredCurrentTests,
  runUnknownHigherVersionTests,
  runUnknownLowerVersionTests,
  runUnsetEnvTests,
  runVersionRejectionTableTests,
  runVersionZeroWindowTests,
} from "./credential-keys.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E8.4 — the credential key resolver (ADR 0062 decisions 1, 2, 4, 5)", () => {
  it("defaults an unset env to version 1 with no keys", () => {
    runUnsetEnvTests();
  });

  it("reads an empty string as unset for all three variables", () => {
    runEmptyStringIsUnsetTests();
  });

  it("decodes KEY through the injected decoder, byte for byte", () => {
    runCurrentKeyPositiveControlTests();
  });

  it("loads PREVIOUS and parses VERSION", () => {
    runPreviousKeyAndVersionTests();
  });

  it("refuses a VERSION that is not a positive integer", () => {
    runVersionRejectionTableTests();
  });

  it("refuses a KEY that is not 32 bytes (Amendment 1)", () => {
    runCurrentKeyLengthTests();
  });

  it("refuses a PREVIOUS that is not 32 bytes (decision 5)", () => {
    runPreviousKeyLengthTests();
  });

  it("refuses a previous key at version 0 (decision 5)", () => {
    runVersionZeroWindowTests();
  });

  it("refuses PREVIOUS while KEY is unset (Amendment 1)", () => {
    runPreviousWithoutCurrentTests();
  });

  it("lists the loaded versions without a phantom previous", () => {
    runLoadedKeyVersionsTests();
  });

  it("selects the current key for the current version", () => {
    runKeyForCurrentVersionTests();
  });

  it("selects the previous key for the current version minus one", () => {
    runKeyForPreviousVersionTests();
  });

  it("refuses an unknown lower version instead of guessing (decision 4)", () => {
    runUnknownLowerVersionTests();
  });

  it("refuses an unknown higher version instead of guessing (decision 4)", () => {
    runUnknownHigherVersionTests();
  });

  it("refuses null, NaN and a string as a stored version", () => {
    runNonIntegerVersionTableTests();
  });

  it("refuses the current version when the current key is unconfigured", () => {
    runUnconfiguredCurrentTests();
  });

  it("refuses version minus one when no previous key is loaded", () => {
    runNoPreviousKeyTests();
  });
});
