import { describe, it } from "vitest";

import {
  aCreateBodyParsesAndTrimsTheLabel,
  theCreateBodyIsStrict,
  theLabelIsOneToThirtyTwoCharactersAfterTrim,
  thePointKeyIsACatalogCode,
  theToneIsOneOfTheFive,
  theUpdateBodyRefusesPointKeyAndValue,
  theUpdateBodyTakesLabelAndToneOnly,
  theValueIsAnyFiniteNumber,
} from "./point-key-state-writes.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.309 — the state-label write bodies (ADR 0088 Amendment 3 decision 4)", () => {
  it("parses a create body and trims its label", () => aCreateBodyParsesAndTrimsTheLabel());
  it("bounds the trimmed label to 1–32 characters", () => theLabelIsOneToThirtyTwoCharactersAfterTrim());
  it("takes one of the five tones", () => theToneIsOneOfTheFive());
  it("takes any finite value (Q7)", () => theValueIsAnyFiniteNumber());
  it("takes a catalog code as the point key", () => thePointKeyIsACatalogCode());
  it("refuses an extra or a missing key on create", () => theCreateBodyIsStrict());
  it("takes the label and the tone only on update", () => theUpdateBodyTakesLabelAndToneOnly());
  it("refuses a point key or a value on update", () => theUpdateBodyRefusesPointKeyAndValue());
});
