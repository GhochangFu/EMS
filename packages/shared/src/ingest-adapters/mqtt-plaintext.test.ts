import { describe, it } from "vitest";

import {
  assertABadEntryThrowsByPositionOnly,
  assertBlankInputParsesToAnEmptySet,
  assertEntriesAreTrimmedAndLowerCased,
  assertListedIsPlainAndUnlistedIsRefused,
  assertOnlyLiteralFalseSelectsPlain,
  assertTheConfigSchemaTlsField,
  assertTheDraftSchemaTlsField,
  assertTheGrammarRefusesNonHostNames,
  assertTheRefusalMessageIsFixed,
} from "./mqtt-plaintext.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.326 — plain MQTT for allowlisted brokers (ADR 0114 decisions 1, 2)", () => {
  it("P1 parses unset or blank to an empty set", () => {
    assertBlankInputParsesToAnEmptySet();
  });
  it("P2 trims and lower-cases each entry", () => {
    assertEntriesAreTrimmedAndLowerCased();
  });
  it("P3 refuses a bad entry by its position, never its text", () => {
    assertABadEntryThrowsByPositionOnly();
  });
  it("P4 refuses wildcards, IPv6, ports and other non-host names", () => {
    assertTheGrammarRefusesNonHostNames();
  });
  it("P5 selects plain only for the literal false", () => {
    assertOnlyLiteralFalseSelectsPlain();
  });
  it("P6 allows a listed host and refuses an unlisted one", () => {
    assertListedIsPlainAndUnlistedIsRefused();
  });
  it("P7 carries the fixed refusal message", () => {
    assertTheRefusalMessageIsFixed();
  });
  it("P8 gives the config schema a tls field defaulting on", () => {
    assertTheConfigSchemaTlsField();
  });
  it("P9 checks the draft tls field as a boolean", () => {
    assertTheDraftSchemaTlsField();
  });
});
