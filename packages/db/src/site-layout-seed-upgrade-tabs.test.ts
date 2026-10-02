import { describe, it } from "vitest";

import {
  aBoundLegendKeepsTheOverview,
  aCsmocV3ElectricalTabGainsTheBreakerTable,
  aCsmocV3OverviewGainsTheCompactDiagram,
  aDeletedBindableTileKeepsTheElectricalTab,
  aDeletedWidgetKeepsTheOverview,
  aMovedRailKeepsTheElectricalTab,
  aMovedTileKeepsTheOverview,
  anAddedWidgetKeepsTheElectricalTab,
  anAddedWidgetKeepsTheOverview,
  anAbsentUnbindableTileStillUpgrades,
  anEditedMimicKeepsTheElectricalTab,
  anEditedRailKeepsTheOverview,
  anOverviewWithNoElectricalTabGetsNoDiagram,
  anUnboundKeptTileKeepsTheElectricalTab,
  anUntiledElectricalTabGetsThePackedBreakerTable,
  aPheV3ElectricalTabGainsTheBreakerTable,
  aPheV3OverviewGainsTheCompactDiagram,
  aRepeatedWidgetKeepsTheOverview,
  aV4ElectricalTabIsNotUpgradedAgain,
  aV4OverviewIsNotUpgradedAgain,
  theCopyKeepsTheTilesWhoseRoleHasThePoint,
  theElectricalStepReadsTheElectricalTabOnly,
  theOverviewStepReadsTheOverviewOnly,
  theV3StepLeavesAV4OverviewAndDoesNotThrow,
  theV3StepStillMovesAPackedV2OverviewToV3,
} from "./site-layout-seed-upgrade-tabs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.74 — the seed upgrade's v3 → v4 Overview step", () => {
  it("U1: gives CSMOC's v3 Overview the compact diagram and moves the strip beside it", () => {
    aCsmocV3OverviewGainsTheCompactDiagram();
  });
  it("U2: gives a PHE station's v3 Overview the same plan", () => {
    aPheV3OverviewGainsTheCompactDiagram();
  });
  it("U2b: gives a copy with no electrical tab no diagram and packs its strip left", () => {
    anOverviewWithNoElectricalTabGetsNoDiagram();
  });
  it("U3: leaves an Overview with one tile moved whole", () => {
    aMovedTileKeepsTheOverview();
  });
  it("U4: leaves an Overview with a widget added whole", () => {
    anAddedWidgetKeepsTheOverview();
  });
  it("U4: leaves an Overview with a widget deleted whole", () => {
    aDeletedWidgetKeepsTheOverview();
  });
  it("U4: leaves an Overview with a widget repeated whole", () => {
    aRepeatedWidgetKeepsTheOverview();
  });
  it("U5: leaves an Overview whose rail rows were edited whole", () => {
    anEditedRailKeepsTheOverview();
  });
  it("U6: leaves an Overview whose legend holds a point row whole", () => {
    aBoundLegendKeepsTheOverview();
  });
  it("U7: does not upgrade a v4 Overview again", () => {
    aV4OverviewIsNotUpgradedAgain();
  });
  it("U7: the v2 → v3 step leaves a v4 Overview and does not throw", () => {
    theV3StepLeavesAV4OverviewAndDoesNotThrow();
  });
  it("U8: the v2 → v3 step still moves a packed v2 Overview to v3 and inserts nothing", () => {
    theV3StepStillMovesAPackedV2OverviewToV3();
  });
  it("reads the Overview only", () => {
    theOverviewStepReadsTheOverviewOnly();
  });
});

describe("F3.74 — the seed upgrade's v3 → v4 electrical step", () => {
  it("E1: gives CSMOC's v3 electrical tab the single line and the breaker table, the lower row down five", () => {
    aCsmocV3ElectricalTabGainsTheBreakerTable();
  });
  it("E2: gives a PHE electrical tab with only Frequency bound the same ops", () => {
    aPheV3ElectricalTabGainsTheBreakerTable();
  });
  it("E2b: packs the breaker table of a tab that kept no tile to y7, the lower row to y12", () => {
    anUntiledElectricalTabGetsThePackedBreakerTable();
  });
  it("E3: leaves an electrical tab with the rail moved whole", () => {
    aMovedRailKeepsTheElectricalTab();
  });
  it("E4: leaves an electrical tab whose kept role tile holds no point whole", () => {
    anUnboundKeptTileKeepsTheElectricalTab();
  });
  it("E5: does not upgrade a v4 electrical tab again", () => {
    aV4ElectricalTabIsNotUpgradedAgain();
  });
  it("E6: leaves an electrical tab with a widget added whole", () => {
    anAddedWidgetKeepsTheElectricalTab();
  });
  it("E7: leaves an electrical tab whose mimic config was edited whole", () => {
    anEditedMimicKeepsTheElectricalTab();
  });
  it("E8: leaves an electrical tab whole when a tile the copy would keep is absent", () => {
    aDeletedBindableTileKeepsTheElectricalTab();
  });
  it("E9: still upgrades an electrical tab whose absent tile binds nothing at the site", () => {
    anAbsentUnbindableTileStillUpgrades();
  });
  it("E10: keeps the role tiles whose role has a member with the tile's point", () => {
    theCopyKeepsTheTilesWhoseRoleHasThePoint();
  });
  it("reads the electrical tab only", () => {
    theElectricalStepReadsTheElectricalTabOnly();
  });
});
