// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { useThemeStore } from "../stores/theme-store";
import {
  CHART_NAMES,
  f1ThemeIsTheRolesTheme,
  f2LoadTrendAreaIsAccentAtTwelvePercent,
  f2LoadTrendLineIsAccent,
  f3StackColoursAreGridDgSolar,
  f4BarColourIsInfo,
  f5DonutSlicesAreTheOq4BandsCycling,
  f6AThemeToggleReRendersWithTheDarkAccent,
  f6AThemeToggleReRendersWithTheDarkTheme,
  f7TogglePassesTheDarkThemeObject,
  f7ToggleRepaintsTheOptionColour,
  resetRecorded,
  TOGGLED_CHART_NAMES,
} from "./charts-follow-theme.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); jsdom, because the
 * charts render and read the roles from `<html>`.
 */
describe("F3.65c the charts follow the theme", () => {
  afterEach(() => {
    cleanup();
    resetRecorded();
    useThemeStore.getState().setTheme("light");
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  for (const chart of CHART_NAMES) {
    it(`F1 ${chart} passes theme = echartsTheme(currentRoles())`, () => {
      f1ThemeIsTheRolesTheme(chart);
    });
  }

  it("F2 LoadTrendChart color[0] is accent", () => {
    f2LoadTrendLineIsAccent();
  });

  it("F2 LoadTrendChart areaStyle.color is accent at 0.12 (dark)", () => {
    f2LoadTrendAreaIsAccentAtTwelvePercent();
  });

  it("F3 EnergySourceStackChart color is [ink-faint, warning, accent]", () => {
    f3StackColoursAreGridDgSolar();
  });

  it("F4 EnergyTopBarChart color is [info]", () => {
    f4BarColourIsInfo();
  });

  it("F5 HealthSummaryDonut slices are accent, accent-strong, warning-on-dark, warning, critical, cycling (OQ4)", () => {
    f5DonutSlicesAreTheOq4BandsCycling();
  });

  it("F6 a theme toggle re-renders LoadTrendChart with the dark accent", () => {
    f6AThemeToggleReRendersWithTheDarkAccent();
  });

  it("F6 a theme toggle re-renders EnergyTopBarChart with the dark theme object", () => {
    f6AThemeToggleReRendersWithTheDarkTheme();
  });

  for (const chart of TOGGLED_CHART_NAMES) {
    it(`F7 a light-to-dark toggle repaints ${chart}'s option colour with the dark role`, () => {
      f7ToggleRepaintsTheOptionColour(chart);
    });

    it(`F7 a light-to-dark toggle passes ${chart} the dark theme object`, () => {
      f7TogglePassesTheDarkThemeObject(chart);
    });
  }
});
