import { describe, it } from "vitest";

import {
  formatWidgetValueAbbreviatesOnlyWhenAsked,
  formatWidgetValueHonoursDecimalsBelowTheAbbreviationThreshold,
  formatWidgetValueRendersAnEmDashForNull,
  formatWidgetValueRoundsAndUnrounds,
  tankFillGeometryComputesTheRectFromThePercentage,
  tankFillGeometryLabelHonoursDecimals,
  tankFillGeometryRendersNoDataBoundForANullPercentage,
  tankReadoutFitsInsideTheVessel,
  tankFillPercentClampsIntoZeroToOneHundred,
  tankFillPercentGuardsAZeroOrInvalidFullScale,
  toKpiTilePropsDoesNotDoubleRenderTheUnit,
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

  it("honours decimals below the abbreviation threshold, not just above it", () => {
    formatWidgetValueHonoursDecimalsBelowTheAbbreviationThreshold();
  });

  it("clamps a tank fill percentage into [0, 100]", () => {
    tankFillPercentClampsIntoZeroToOneHundred();
  });

  it("guards a zero full-scale or a null reading rather than dividing", () => {
    tankFillPercentGuardsAZeroOrInvalidFullScale();
  });

  it("computes the tank fill rect's y/height from the percentage", () => {
    tankFillGeometryComputesTheRectFromThePercentage();
  });

  it("renders 'No data bound' with zero height for a null percentage", () => {
    tankFillGeometryRendersNoDataBoundForANullPercentage();
  });

  it("keeps whatever it draws inside the vessel", () => {
    tankReadoutFitsInsideTheVessel();
  });

  it("honours decimals on the tank fill label", () => {
    tankFillGeometryLabelHonoursDecimals();
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

  it("does not double-render the unit into both the value and KpiTile's own unit prop", () => {
    toKpiTilePropsDoesNotDoubleRenderTheUnit();
  });
});
