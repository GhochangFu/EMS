import { describe, it } from "vitest";

import {
  aViewIntoALargerBufferDecodes,
  anotherLengthIsAMismatch,
  everyFieldTypeReads,
  hexAndTotality,
  theByteOrderTwinDecodesDifferently,
  theGoatGoldenSampleDecodes,
  theRawGoldenSampleIsAllZero,
  theReadingsCapIs128,
  theSchemaRefusesBadShapes,
  theVapFaultCodesAreAbsent,
  theWbldcDefinitionParses,
  timesAndImpossibleDates,
} from "./mqtt-payload-format-binary.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.343 — the binary payload format schema (ADR 0119 decision 1)", () => {
  it("parses the WBLDC definition", () => theWbldcDefinitionParses());
  it("refuses bad shapes at their paths", () => theSchemaRefusesBadShapes());
  it("caps readings at 128", () => theReadingsCapIs128());
});

describe("F4.343 — decodeBinary (ADR 0119 decision 2)", () => {
  it("1 decodes the GOAT golden sample", () => theGoatGoldenSampleDecodes());
  it("2 decodes the byte-order twin differently", () => theByteOrderTwinDecodesDifferently());
  it("3 leaves the VAP fault codes absent", () => theVapFaultCodesAreAbsent());
  it("4 decodes the RAW golden sample as zeros", () => theRawGoldenSampleIsAllZero());
  it("5 refuses any other length", () => anotherLengthIsAMismatch());
  it("6 reads a view part-way into a larger buffer", () => aViewIntoALargerBufferDecodes());
  it("7 reads times and leaves an impossible date absent", () => timesAndImpossibleDates());
  it("8 reads every field type", () => everyFieldTypeReads());
  it("9 parses hex and never throws", () => hexAndTotality());
});
