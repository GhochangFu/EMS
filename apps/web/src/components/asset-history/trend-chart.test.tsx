// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  aForecastMovesTheAxisPastTo,
  aMarkBringsTheCaption,
  noMarkNoCaption,
  aStaleWindowDrawsNoForecastOrCaption,
  noForecastKeepsTheAxisAtTo,
  resetRecorded,
} from "./trend-chart.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
beforeEach(() => {
  resetRecorded();
});
afterEach(() => {
  cleanup();
});

describe("E1.4a — the history trend chart's axis and forecast", () => {
  it("a forecast moves the axis past to", () => aForecastMovesTheAxisPastTo());
  it("no forecast keeps the axis at to", () => noForecastKeepsTheAxisAtTo());
  it("a window that ended over an hour before asOf draws no forecast or caption", () =>
    aStaleWindowDrawsNoForecastOrCaption());
});

describe("E1.2b — the unusual-hour marks and their caption", () => {
  it("a drawn mark brings the advisory caption", () => aMarkBringsTheCaption());
  it("no mark drawn, no caption", () => noMarkNoCaption());
});
