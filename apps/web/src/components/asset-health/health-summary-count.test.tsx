// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aCachedAnswerDoesNotDrawWithoutAScoredAsset,
  anEmptySummaryMakesNoBadActorsRequest,
  noLineForZeroNullOrARejectedRead,
  theDonutDoesNotWaitForTheCount,
  theLineAndThePillShowForAtLeastOne,
  theRequestCarriesTheSectionsScope,
} from "./health-summary-count.spec";

// jsdom implements no canvas; the donut's legend and figures are ordinary DOM.
vi.mock("echarts-for-react", () => ({
  default: () => null,
}));

/**
 * `E1.8b` T2.6 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014), and the jsdom docblock is here because this is the file Vitest
 * collects (ADR 0042 decision 2).
 */
describe("E1.8b the count of assets losing points under the donut", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the sentence and the info pill for at least one losing asset", async () => {
    await theLineAndThePillShowForAtLeastOne();
  });

  it("shows nothing for zero, for anomaly null, or for a rejected read", async () => {
    await noLineForZeroNullOrARejectedRead();
  });

  it("draws the donut while the bad-actors read is still pending", async () => {
    await theDonutDoesNotWaitForTheCount();
  });

  it("makes no bad-actors request for an empty summary", async () => {
    await anEmptySummaryMakesNoBadActorsRequest();
  });

  it("sends the section's own scope with the request", async () => {
    await theRequestCarriesTheSectionsScope();
  });

  it("draws no line from a cached answer when the summary has no scored asset", async () => {
    await aCachedAnswerDoesNotDrawWithoutAScoredAsset();
  });
});
