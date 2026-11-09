import { describe, it } from "vitest";

import {
  aJsonMessageOfTheSameLengthStaysJson,
  aPheEnvelopeDecodesWithTheBuiltin,
  aShortBinaryFrameIsNoFormat,
  anArrayRootYieldsTwoDevices,
  decodedValuesAreRedactedAsBefore,
  eachSkipIsCountedByReason,
  theBcplSampleDecodesWithItsFormat,
  theFirstFormatStaysAndTheChosenGoesFirst,
  theGoatFrameDecodesWithTheBinaryFormat,
  theVapFaultChannelsAreAbsent,
} from "./discovery-collector-formats.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 — the discovery collector tries every payload format (ADR 0116 decision 8)", () => {
  it("C1 decodes the BCPL sample and records its format", () => theBcplSampleDecodesWithItsFormat());
  it("C2 decodes a PHE envelope with the built-in", () => aPheEnvelopeDecodesWithTheBuiltin());
  it("C3 counts each skip by reason (F4.335)", () => eachSkipIsCountedByReason());
  it("C4 keeps a device's first format and tries the chosen one first", () => theFirstFormatStaysAndTheChosenGoesFirst());
  it("C5 groups an array-root message into several devices", () => anArrayRootYieldsTwoDevices());
  it("C6 redacts decoded values as before", () => decodedValuesAreRedactedAsBefore());
});

describe("F4.343 — the discovery collector tries binary formats (ADR 0119 decision 4)", () => {
  it("C7 decodes the GOAT frame with the binary format", () => theGoatFrameDecodesWithTheBinaryFormat());
  it("C8 leaves the VAP fault channels out", () => theVapFaultChannelsAreAbsent());
  it("C9 never reads a JSON message as a binary record", () => aJsonMessageOfTheSameLengthStaysJson());
  it("C10 counts a short binary frame as no-format", () => aShortBinaryFrameIsNoFormat());
});
