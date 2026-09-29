import { describe, it } from "vitest";

import {
  c1TooltipBackgroundIsSurface,
  c2EveryAxisLabelIsInkMuted,
  c3GaugeDetailIsInk,
  c4TheFirstSeriesColourIsAccent,
  c4TheThemePaletteIsTheSeriesPalette,
  c5EveryLeafIsARoleOrARoleWithAlpha,
  c5TheThemeHasStringLeavesToCheck,
  type ThemeName,
} from "./chart-theme.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). Node environment. */
describe.each<ThemeName>(["light", "dark"])("F3.65c ECharts theme (%s)", (name) => {
  it("C1 tooltip.backgroundColor is surface", () => {
    c1TooltipBackgroundIsSurface(name);
  });

  it("C2 axisLabel.color is ink-muted on value, category, time and log axes", () => {
    c2EveryAxisLabelIsInkMuted(name);
  });

  it("C3 gauge.detail.color is ink", () => {
    c3GaugeDetailIsInk(name);
  });

  it("C4 color[0] is accent", () => {
    c4TheFirstSeriesColourIsAccent(name);
  });

  it("C4 the theme palette is seriesPalette(roles)", () => {
    c4TheThemePaletteIsTheSeriesPalette(name);
  });

  it("C5 every string leaf is a role or a role with alpha", () => {
    c5EveryLeafIsARoleOrARoleWithAlpha(name);
  });

  it("C5 the theme has string leaves to check (the scan is live)", () => {
    c5TheThemeHasStringLeavesToCheck(name);
  });
});
