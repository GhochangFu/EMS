import { describe, it } from "vitest";

import {
  formatWidgetValueAbbreviatesOnlyWhenAsked,
  formatWidgetValueRendersAnEmDashForNull,
  formatWidgetValueRoundsAndUnrounds,
  tankFillPercentClampsIntoZeroToOneHundred,
  tankFillPercentGuardsAZeroOrInvalidFullScale,
  toKpiTilePropsHidesTheValueOffTheReadyStatus,
  toKpiTilePropsMapsAllFourTonesExhaustively,
  widgetTitleFallsBackToTheCatalogLabel,
} from "./widget-value.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("widget-value", () => {
  it("rounds a value to the configured decimals, and does not round when absent", () => {
    formatWidgetValueRoundsAndUnrounds();
  });

  it("renders an em dash for a null reading, never the literal string 'null'", () => {
    formatWidgetValueRendersAnEmDashForNull();
  });

  it("abbreviates only when the config asks for it", () => {
    formatWidgetValueAbbreviatesOnlyWhenAsked();
  });

  it("clamps a tank fill percentage into [0, 100]", () => {
    tankFillPercentClampsIntoZeroToOneHundred();
  });

  it("guards a zero full-scale or a null reading rather than dividing", () => {
    tankFillPercentGuardsAZeroOrInvalidFullScale();
  });

  it("falls back to the catalog label for a null or empty title", () => {
    widgetTitleFallsBackToTheCatalogLabel();
  });

  it("maps all four widget tones onto KpiTile's three tones", () => {
    toKpiTilePropsMapsAllFourTonesExhaustively();
  });

  it("hides the formatted value off the ready status", () => {
    toKpiTilePropsHidesTheValueOffTheReadyStatus();
  });
});
