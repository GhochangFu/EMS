// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aLoadingChartShowsNoTotal,
  aSevenDayChartHasNoSwitch,
  theSwitchDefaultsToThirtyAndChangesTheTotal,
} from "./cost-by-day-chart-widget.spec";

vi.mock("echarts-for-react", () => ({ default: () => null }));

/** `F4.332` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.332 — the daily energy cost chart widget", () => {
  afterEach(() => cleanup());

  it("opens on 30 days and the switch changes the total", () => theSwitchDefaultsToThirtyAndChangesTheTotal());
  it("draws no switch for a seven-day chart", () => aSevenDayChartHasNoSwitch());
  it("shows no total while loading", () => aLoadingChartShowsNoTotal());
});
