import { describe, it } from "vitest";

import {
  runBucketTest,
  runConstantsTest,
  runListRowTest,
  runNotStrictTest,
  runNullForecastTest,
  runRunFieldsTest,
} from "./ml-forecasts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.4a — the forecast read contracts (ADR 0135 Amendment 3)", () => {
  it("stale after 3 h, and a 64 h look-back", () => {
    runConstantsTest();
  });

  it("forecast: null parses, and forecast is required", () => {
    runNullForecastTest();
  });

  it("a bucket without p10, with NaN, or with a bad time is refused", () => {
    runBucketTest();
  });

  it("an unknown extra key still parses (responses are not strict)", () => {
    runNotStrictTest();
  });

  it("the list row bounds pointKey at 128, unit at 32, and the model fields at 128", () => {
    runListRowTest();
  });

  it("carries only three run fields, and strips any other (S3)", () => {
    runRunFieldsTest();
  });
});
