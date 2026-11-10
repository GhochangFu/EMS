import { describe, it } from "vitest";

import {
  aGoodBatchParses,
  aMissingDeviceKeyIsRefused,
  aMissingRxIsRefused,
  anEmptyBatchIsRefused,
  anUnknownVersionIsRefused,
  deviceTimeIsOptional,
  moreThanFiveHundredSamplesIsRefused,
  theResponseCarriesFourRejectionBuckets,
  theTokenPatternIsExact,
} from "./ingest-uplink.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — uplink wire schema (ADR 0123 decision 4)", () => {
  it("parses a good batch", () => {
    aGoodBatchParses();
  });

  it("refuses more than 500 samples at `samples`", () => {
    moreThanFiveHundredSamplesIsRefused();
  });

  it("refuses an empty batch", () => {
    anEmptyBatchIsRefused();
  });

  it("refuses a sample with no rx", () => {
    aMissingRxIsRefused();
  });

  it("refuses a sample with no deviceKey", () => {
    aMissingDeviceKeyIsRefused();
  });

  it("refuses v: 2", () => {
    anUnknownVersionIsRefused();
  });

  it("keeps at optional", () => {
    deviceTimeIsOptional();
  });

  it("answers with four rejection buckets", () => {
    theResponseCarriesFourRejectionBuckets();
  });

  it("pins the token pattern", () => {
    theTokenPatternIsExact();
  });
});
