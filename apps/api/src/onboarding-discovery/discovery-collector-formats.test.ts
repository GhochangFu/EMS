import { describe, it } from "vitest";

import {
  aPheEnvelopeDecodesWithTheBuiltin,
  anArrayRootYieldsTwoDevices,
  decodedValuesAreRedactedAsBefore,
  eachSkipIsCountedByReason,
  theBcplSampleDecodesWithItsFormat,
  theFirstFormatStaysAndTheChosenGoesFirst,
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
