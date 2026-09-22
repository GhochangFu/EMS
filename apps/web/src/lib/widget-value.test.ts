import { describe, it } from "vitest";

import {
  aMoneyMetricRendersTheFormattedAmount,
  aNonMoneyTileIsUnaffectedByTheCurrencyPath,
  aNullCurrencyRendersThePlainNumber,
  coverageNoteIsSilentWhenEveryAssetIsFresh,
  coverageNoteIsSilentWhenNoAssetCarriesTheCode,
  coverageNoteIsSilentWithoutACoverageObject,
  coverageNoteNamesAShortfall,
  formatBucketWidthCoversTheFourLadderRungs,
  formatDeltaIsNullWithoutAComputablePercentage,
  formatDeltaMatchesTheMocksExactWording,
  formatDeltaSignsDirectionCorrectlyAndFlatOnATinyChange,
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
  toKpiTilePropsHintPrecedence,
  toKpiTilePropsLetsACallerSuppliedToneWinOverConfigsTone,
  toKpiTilePropsMapsAllFourTonesExhaustively,
  toKpiTilePropsReadsToneFromConfigThroughTheExistingMap,
  widgetTitleFallsBackToTheCatalogLabel,
  theNoteDoesNotDisplaceTheHint,
  toKpiTilePropsWithholdsTheNoteWhenNotReady,
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

  it("formats a delta matching the Nexus mock's exact wording", () => {
    formatDeltaMatchesTheMocksExactWording();
  });

  it("returns null for a delta with no computable percentage", () => {
    formatDeltaIsNullWithoutAComputablePercentage();
  });

  it("signs the delta's direction correctly, and calls a tiny change flat rather than arrowed", () => {
    formatDeltaSignsDirectionCorrectlyAndFlatOnATinyChange();
  });

  it("reads tone from config.tone through the existing tone map", () => {
    toKpiTilePropsReadsToneFromConfigThroughTheExistingMap();
  });

  it("lets a caller-supplied tone win over config.tone", () => {
    toKpiTilePropsLetsACallerSuppliedToneWinOverConfigsTone();
  });

  it("fills the hint slot from at most one source, per the one-slot precedence", () => {
    toKpiTilePropsHintPrecedence();
  });

  it("names each of the four ladder bucket widths, and any width that is none of them", () => {
    formatBucketWidthCoversTheFourLadderRungs();
  });

  it("names a coverage shortfall", () => {
    coverageNoteNamesAShortfall();
  });

  it("says nothing when every carrying asset is fresh", () => {
    coverageNoteIsSilentWhenEveryAssetIsFresh();
  });

  it("says nothing when no asset carries the code", () => {
    coverageNoteIsSilentWhenNoAssetCarriesTheCode();
  });

  it("says nothing without a coverage object", () => {
    coverageNoteIsSilentWithoutACoverageObject();
  });

  it("withholds the note unless the widget is ready", () => {
    toKpiTilePropsWithholdsTheNoteWhenNotReady();
  });

  it("puts the note in its own slot, leaving the hint alone", () => {
    theNoteDoesNotDisplaceTheHint();
  });
});

describe("E4.2 sweep — the money tile renders the organization's currency", () => {
  it("renders the formatted amount for a metric that ships a currency", () => {
    aMoneyMetricRendersTheFormattedAmount();
  });

  it("renders the plain number when the currency is null", () => {
    aNullCurrencyRendersThePlainNumber();
  });

  it("leaves a non-money tile's own formatting alone", () => {
    aNonMoneyTileIsUnaffectedByTheCurrencyPath();
  });
});
