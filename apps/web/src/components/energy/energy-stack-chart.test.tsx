// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  aReadyChartRendersTheStacks,
  anEmptyChartSaysSo,
  anErrorChartRendersTheFixedSentence,
  resetRecorded,
} from "./energy-stack-chart.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
beforeEach(() => {
  resetRecorded();
});
afterEach(() => {
  cleanup();
});

describe("F4.299 energy stack chart", () => {
  it("renders the stacks when ready", () => {
    aReadyChartRendersTheStacks();
  });
  it("renders a fixed sentence when empty", () => {
    anEmptyChartSaysSo();
  });
  it("renders a fixed sentence on error", () => {
    anErrorChartRendersTheFixedSentence();
  });
});
