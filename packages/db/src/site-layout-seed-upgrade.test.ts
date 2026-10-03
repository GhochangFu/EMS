import { describe, it } from "vitest";

import {
  aCsmocPackedV2OverviewMovesToV3,
  aFullyBoundTabWritesNothing,
  aMovedCardKeepsTheOverview,
  aMovedWidgetKeepsItsTab,
  anAddedOrRepeatedWidgetKeepsTheOverview,
  anEditedConfigKeepsTheOverview,
  anEditedDescriptionIsKept,
  anEditedTabIsNotPacked,
  anOverviewAtItsV1RectsMovesToV2,
  anUnboundTileIsDeletedAndTheRowPacked,
  anUnpackedOverviewHasItsCardsPacked,
  anUnpackedOverviewIsNotUpgraded,
  aPackedTabIsNotPackedAgain,
  aPhePackedV2OverviewMovesToV3,
  aReorderedConfigStillUpgrades,
  aTabAlreadyAtV2WritesNothing,
  aTabAtItsV1RectsMovesToV2,
  aTabThatLosesEveryTileIsLifted,
  aTemplateRowTheSeedDoesNotOwnIsKept,
  aTileWithNoSourceRowKeepsTheOverview,
  anInsertThatReturnsNoRowThrowsNamingTheRunner,
  aV3OverviewIsNotUpgradedAgain,
  aWidgetTheTemplateDoesNotHoldKeepsItsTab,
  everyTemplateWidgetHasItsOwnIdentity,
  theDefaultCurrentVersionIsTheLiveStock,
  theNewDescriptionNamesNoRowSeedOrDemo,
  theOfflineTileGetsTheOfflineIcon,
  theSeedsOlderStockRowsAreSuperseded,
  theSeedsStockThreeRowIsSupersededByStockFour,
  theStepReadsTheOverviewOnly,
  theV1DescriptionIsReplaced,
  theV1TableNamesExactlyTheV2Widgets,
} from "./site-layout-seed-upgrade.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.77 — the seed upgrade's v2 → v3 Overview step", () => {
  it("moves a PHE Overview at its packed v2 plan to v3 and deletes its two cards", () => {
    aPhePackedV2OverviewMovesToV3();
  });
  it("gives the Offline tile the offline icon and keeps the list's title", () => {
    theOfflineTileGetsTheOfflineIcon();
  });
  it("moves a CSMOC Overview with four packed cards to v3", () => {
    aCsmocPackedV2OverviewMovesToV3();
  });
  it("keeps an Overview with one card moved by one row", () => {
    aMovedCardKeepsTheOverview();
  });
  it("keeps an Overview that is not packed yet", () => {
    anUnpackedOverviewIsNotUpgraded();
  });
  it("keeps an Overview whose tile lost its source row or whose widget gained a point", () => {
    aTileWithNoSourceRowKeepsTheOverview();
  });
  it("keeps an Overview whose config an administrator changed", () => {
    anEditedConfigKeepsTheOverview();
  });
  it("upgrades an Overview whose stored config only has another key order", () => {
    aReorderedConfigStillUpgrades();
  });
  it("keeps an Overview with an added or repeated widget", () => {
    anAddedOrRepeatedWidgetKeepsTheOverview();
  });
  it("writes nothing for a v3 Overview", () => {
    aV3OverviewIsNotUpgradedAgain();
  });
  it("reads the Overview only", () => {
    theStepReadsTheOverviewOnly();
  });
});

describe("F3.74 — the seed upgrade runner's insert guard", () => {
  it("I6: throws naming the runner when an insert returns no row", async () => {
    await anInsertThatReturnsNoRowThrowsNamingTheRunner();
  });
});

describe("F3.77 — the seed's supersede rule for its own older stock row", () => {
  it("supersedes the seed's stock-1 and stock-2 rows", () => {
    theSeedsOlderStockRowsAreSuperseded();
  });
  it("supersedes the seed's stock-3 row at version 2 once the current stock is 4", () => {
    theSeedsStockThreeRowIsSupersededByStockFour();
  });
  it("keeps a template row the seed does not own or that is current", () => {
    aTemplateRowTheSeedDoesNotOwnIsKept();
  });
  it("compares with the live stock version by default", () => {
    theDefaultCurrentVersionIsTheLiveStock();
  });
});

describe("F3.73 — the seed upgrade's v2 → packed step", () => {
  it("packs an unpacked Overview's cards left", () => {
    anUnpackedOverviewHasItsCardsPacked();
  });
  it("deletes an unbound role tile and packs its row", () => {
    anUnboundTileIsDeletedAndTheRowPacked();
  });
  it("lifts a tab's body when it loses every tile", () => {
    aTabThatLosesEveryTileIsLifted();
  });
  it("packs no tab an administrator edited", () => {
    anEditedTabIsNotPacked();
  });
  it("packs nothing a second time", () => {
    aPackedTabIsNotPackedAgain();
  });
  it("writes nothing for a tab whose tiles are all bound", () => {
    aFullyBoundTabWritesNothing();
  });
});

describe("F3.73 — the SMOC standard site layout's v1 → v2 seed upgrade", () => {
  it("replaces the v1 seed's copy description", () => {
    theV1DescriptionIsReplaced();
  });
  it("keeps an edited copy description", () => {
    anEditedDescriptionIsKept();
  });
  it("writes a description that names no row id, seed or demo", () => {
    theNewDescriptionNamesNoRowSeedOrDemo();
  });
  it("knows each template widget by its own tab, type and title", () => {
    everyTemplateWidgetHasItsOwnIdentity();
  });
  it("holds a v1 rect for exactly the v2 widgets", () => {
    theV1TableNamesExactlyTheV2Widgets();
  });
  it("moves a tab still at its v1 rects to v2", () => {
    aTabAtItsV1RectsMovesToV2();
  });
  it("moves a v1 Overview to the frozen v2 rects, cards included", () => {
    anOverviewAtItsV1RectsMovesToV2();
  });
  it("keeps a whole tab when one widget was moved", () => {
    aMovedWidgetKeepsItsTab();
  });
  it("keeps a tab holding a widget the template does not", () => {
    aWidgetTheTemplateDoesNotHoldKeepsItsTab();
  });
  it("writes nothing for a tab already at v2", () => {
    aTabAlreadyAtV2WritesNothing();
  });
});
