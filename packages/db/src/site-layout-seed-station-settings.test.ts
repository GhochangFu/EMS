import { describe, it } from "vitest";

import {
  assertAStampThatWritesNoRowThrows,
  assertAStationConfigThatDoesNotParseIsKept,
  assertAStationTabTheSiteCopyLacksIsKept,
  assertAWidgetChangedDuringTheSeedIsKept,
  assertAStationLayoutOrOtherPresetIsKept,
  assertAnEditedSiteWidgetIsKept,
  assertConsidersCopyTruthTable,
  assertEqualConfigsGiveNoUpdate,
  assertNoMatchAndTwoMatchesAreKept,
  assertOnlyMimicAndTrendStripAreCopied,
  assertPairingNeedsOneWidgetEachWayPerPlace,
  assertTheAwsFixtureCopiesSixWidgets,
} from "./site-layout-seed-station-settings.spec";

describe("F4.388 — a split site's copy takes its station's mimic and trend-strip settings (ADR 0139 Amendment 1)", () => {
  it("S1 copies the six measured demo-host widgets, each from its own tab's station widget", () => {
    assertTheAwsFixtureCopiesSixWidgets();
  });

  it("S2 keeps a site widget that is not as the seed made it and copies the other five", () => {
    assertAnEditedSiteWidgetIsKept();
  });

  it("S3 copies mimic and trend_strip only, never a value_tile at the same rect", () => {
    assertOnlyMimicAndTrendStripAreCopied();
  });

  it("S4 keeps a site widget with no station match or two, the reason named", () => {
    assertNoMatchAndTwoMatchesAreKept();
  });

  it("S5 keeps a site mimic whose station mimic is on the layout arm or another preset", () => {
    assertAStationLayoutOrOtherPresetIsKept();
  });

  it("S6 keeps a site widget whose station config does not parse, or that the write API's strict arm refuses", () => {
    assertAStationConfigThatDoesNotParseIsKept();
  });

  it("S7 gives no update for a site widget already equal to its station widget", () => {
    assertEqualConfigsGiveNoUpdate();
  });

  it("S8 considers a copy made this run, or stamped NULL or below 3, and no other", () => {
    assertConsidersCopyTruthTable();
  });

  it("S9 keeps a site widget whose station config names a tab the site copy does not hold", () => {
    assertAStationTabTheSiteCopyLacksIsKept();
  });

  it("S10 pairs a stored widget with a planned one only when each is alone at its place", () => {
    assertPairingNeedsOneWidgetEachWayPerPlace();
  });

  it("S11 keeps and logs a widget whose update writes no row, counts it out, and still stamps", async () => {
    await assertAWidgetChangedDuringTheSeedIsKept();
  });

  it("S12 throws when the stamp of a copy it read writes no row", async () => {
    await assertAStampThatWritesNoRowThrows();
  });
});
