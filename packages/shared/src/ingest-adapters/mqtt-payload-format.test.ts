import { describe, it } from "vitest";

import {
  aFloat64SpansFourWords,
  aJsonFrameInsideALargerBufferDecodes,
  anUnparsedBinaryDefinitionNeverThrows,
  aSignedWordIsItsSixteenBitPattern,
  absentReadingsAreNullOrOmitted,
  fieldReadingsAcceptNumbersAndNumericStrings,
  pathsAreBoundedAndRefusePrototypeNames,
  rootCapsAndTotality,
  scaleAndOffsetApply,
  theBcplAndBuiltinDefinitionsParse,
  theBcplGoldenSampleDecodes,
  theByteOrderTwinDecodesDifferently,
  theDecoderTakesBytesForEveryKind,
  thePheGoldenSampleMatchesTheEnvelopeParse,
  theReadingShapeIsStrict,
  theReadingsCapIs128,
  theTopicIsTheKeyWhenNoPathIsSet,
  theWordOrderTwinDecodesDifferently,
  timeUnitsAndBadTimes,
  wordAndByteOrderDefaultToBig,
} from "./mqtt-payload-format.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 — the MQTT payload format schema (ADR 0116 decision 3)", () => {
  it("parses the BCPL and built-in definitions", () => theBcplAndBuiltinDefinitionsParse());
  it("caps readings at 128", () => theReadingsCapIs128());
  it("bounds paths and refuses prototype names", () => pathsAreBoundedAndRefusePrototypeNames());
  it("keeps the reading shape strict", () => theReadingShapeIsStrict());
  it("defaults word and byte order to big", () => wordAndByteOrderDefaultToBig());
});

describe("F4.334 — decodeMqttPayload", () => {
  it("1 decodes the BCPL golden sample", () => theBcplGoldenSampleDecodes());
  it("2 decodes the word-order twin differently", () => theWordOrderTwinDecodesDifferently());
  it("2b decodes the byte-order twin differently", () => theByteOrderTwinDecodesDifferently());
  it("3 takes a signed word as its 16-bit pattern", () => aSignedWordIsItsSixteenBitPattern());
  it("3b reads float64 over four words", () => aFloat64SpansFourWords());
  it("4 matches parseMqttEnvelope for the PHE golden sample", () => thePheGoldenSampleMatchesTheEnvelopeParse());
  it("5 yields null or omits, never zero", () => absentReadingsAreNullOrOmitted());
  it("5b reads numbers and numeric strings from fields", () => fieldReadingsAcceptNumbersAndNumericStrings());
  it("6 reads every time unit and leaves a bad time absent", () => timeUnitsAndBadTimes());
  it("7 uses the topic when no device-key path is set", () => theTopicIsTheKeyWhenNoPathIsSet());
  it("8 checks the root and caps and never throws", () => rootCapsAndTotality());
  it("9 applies scale and offset", () => scaleAndOffsetApply());
});

describe("F4.343 — decodeMqttPayload takes bytes (ADR 0119 decision 2)", () => {
  it("10 reads binary bytes as not-json for a JSON kind and dispatches the binary kind", () =>
    theDecoderTakesBytesForEveryKind());
  it("11 decodes a JSON frame inside a larger buffer and keeps a BOM", () => aJsonFrameInsideALargerBufferDecodes());
  it("12 drops, never throws, on an unparsed binary definition", () => anUnparsedBinaryDefinitionNeverThrows());
});
