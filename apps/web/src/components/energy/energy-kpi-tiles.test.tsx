// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aFlatSiteHasNoOwnAssetsHint,
  aLoadingTileShowsNoBadge,
  aNullCostIsADashWithTheReason,
  aVerifyFlagBadgesTheCostTile,
  noVerifyFlagNoBadge,
  aNullPfSaysNoPfPoint,
  aNullPueIsADashWithTheReason,
  aPeriodWithoutDataSaysSo,
  anAreaWithoutDataSaysNoKwData,
  anEmptyPreviousPeriodSaysSo,
  noAreaSaysWhereToSetItEvenWithoutData,
  noOwnAssetDataSaysSo,
  readableChildrenAddTheOwnAssetsHint,
  rendersTheSixTilesInOrder,
  theFloorAreaPropAddsASeventhTileLast,
  theTileShowsTheChange,
  theTileShowsTheServersFigure,
  withoutTheFloorAreaPropThereIsNoKwhPerM2Tile,
  theRollupTileNamesLevelBucketAndZone,
  thePeakTileShowsThePeakKwNotTheTotal,
  thePeakTimeIsInTheViewsZone,
  theTotalTileShowsTheChange,
  theTotalTileShowsTheWholeKwh,
} from "./energy-kpi-tiles.spec";

/** `F4.302` U3 — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  cleanup();
});

describe("F4.302 — the Energy KPI tiles", () => {
  it("renders the six tiles in order", () => {
    rendersTheSixTilesInOrder();
  });

  it("the total tile shows the whole kWh", () => {
    theTotalTileShowsTheWholeKwh();
  });

  it("the peak tile shows the peak kW, not the total", () => {
    thePeakTileShowsThePeakKwNotTheTotal();
  });

  it("the peak time is in the view's zone", () => {
    thePeakTimeIsInTheViewsZone();
  });

  it("the total tile shows the change against the previous period", () => {
    theTotalTileShowsTheChange();
  });

  it("an empty previous period says so", () => {
    anEmptyPreviousPeriodSaysSo();
  });

  it("the rollup tile names the level and the zone", () => {
    theRollupTileNamesLevelBucketAndZone();
  });

  it("a null PUE is a dash with the reason", () => {
    aNullPueIsADashWithTheReason();
  });

  it("a null cost is a dash with the reason", () => {
    aNullCostIsADashWithTheReason();
  });

  it("a null power factor says no pf point", () => {
    aNullPfSaysNoPfPoint();
  });

  it("a period without data says so", () => {
    aPeriodWithoutDataSaysSo();
  });

  it("F4.304: without the floor-area prop there is no kWh per m² tile", () => {
    withoutTheFloorAreaPropThereIsNoKwhPerM2Tile();
  });

  it("F4.304 P1: the floor-area prop adds a seventh tile, last", () => {
    theFloorAreaPropAddsASeventhTileLast();
  });

  it("F4.304 P2: no area says where to set it, even without kW data", () => {
    noAreaSaysWhereToSetItEvenWithoutData();
  });

  it("F4.304 P3: an area without kW data says so", () => {
    anAreaWithoutDataSaysNoKwData();
  });

  it("F4.304 P4: no kW data from the site's own assets says so", () => {
    noOwnAssetDataSaysSo();
  });

  it("F4.304 P5: the tile shows the server's figure in kWh/m²", () => {
    theTileShowsTheServersFigure();
  });

  it("F4.304 P6: the tile shows the change against the previous period", () => {
    theTileShowsTheChange();
  });

  it("F4.304 P7: readable children add the own-assets hint", () => {
    readableChildrenAddTheOwnAssetsHint();
  });

  it("F4.304 P7: a flat site has no own-assets hint", () => {
    aFlatSiteHasNoOwnAssetsHint();
  });

  it("F4.365: tariffVerify badges the Indicative cost tile", () => {
    aVerifyFlagBadgesTheCostTile();
  });

  it("F4.365: no flag, no badge", () => {
    noVerifyFlagNoBadge();
  });

  it("F4.365: a loading tile shows no badge", () => {
    aLoadingTileShowsNoBadge();
  });
});
