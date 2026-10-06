import { describe, it } from "vitest";

import {
  aLoneHashIsAWildcard,
  aLonePlusIsAWildcard,
  aMiddlePlusIsAWildcard,
  aTrailingHashIsAWildcard,
  anEmptyTopicIsNotAWildcard,
  anOrdinaryTopicIsNotAWildcard,
} from "./ingest.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.221 — mqttTopicHasWildcard", () => {
  it("answers true for a lone #", () => {
    aLoneHashIsAWildcard();
  });

  it("answers true for a lone +", () => {
    aLonePlusIsAWildcard();
  });

  it("answers true for a trailing # after real levels", () => {
    aTrailingHashIsAWildcard();
  });

  it("answers true for a + between real levels", () => {
    aMiddlePlusIsAWildcard();
  });

  it("answers false for one device's topic", () => {
    anOrdinaryTopicIsNotAWildcard();
  });

  it("answers false for an empty topic", () => {
    anEmptyTopicIsNotAWildcard();
  });
});
