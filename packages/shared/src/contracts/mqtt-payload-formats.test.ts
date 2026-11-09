import { describe, it } from "vitest";

import {
  theBodiesTakeABinaryDefinitionAndHex,
  theCreateBodyIsDeclarativeOnly,
  theEditableDefinitionKeepsFieldLevelIssues,
  theResponsesParse,
  theRtuFormatBodyTakesACodeOrNull,
  theTestBodyCapsTheSample,
  theUpdateBodyIsStrict,
} from "./mqtt-payload-formats.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 — MQTT payload format contracts (ADR 0116 decision 5)", () => {
  it("takes a declarative definition on create, never the built-in", () => theCreateBodyIsDeclarativeOnly());
  it("keeps the update body strict", () => theUpdateBodyIsStrict());
  it("caps the test sample at 64 KiB", () => theTestBodyCapsTheSample());
  it("parses the row, test and 409 responses", () => theResponsesParse());
  it("takes a code or null on the RTU format route", () => theRtuFormatBodyTakesACodeOrNull());
});

describe("F4.343 — binary definitions and hex samples (ADR 0119 decisions 1, 5)", () => {
  it("takes a binary definition on create and update, and hex on the test body", () =>
    theBodiesTakeABinaryDefinitionAndHex());
  it("keeps field-level issues on the editable definition", () => theEditableDefinitionKeepsFieldLevelIssues());
});
