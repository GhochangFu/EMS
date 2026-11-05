// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aBarUnderAnRtuIsNamedByTheLabel,
  aBarWithNoRtuIsNamedByItsLocation,
  resetRecorded,
  theLabelIsContainedAndBreaksRatherThanClips,
} from "./energy-top-bar-chart.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.316 PR 6 — the top-consumers bar chart names each bar by the asset label (ADR 0111)", () => {
  afterEach(() => {
    cleanup();
    resetRecorded();
  });

  it("a bar under an RTU is <code> · <RTU> · <name>", () => {
    aBarUnderAnRtuIsNamedByTheLabel();
  });

  it("a bar with no RTU is <code> · <location> · <name>", () => {
    aBarWithNoRtuIsNamedByItsLocation();
  });

  it("the label is contained by the grid and breaks rather than clips", () => {
    theLabelIsContainedAndBreaksRatherThanClips();
  });
});
