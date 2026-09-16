import { describe, it } from "vitest";

import {
  assertADegenerateSlugIsPaddedToTwoCharacters,
  assertAChartBindsSeriesAndATilePrimary,
  assertARepeatedMissingKeyReadsUnresolved,
  assertARepeatedPointKeyBindsOnceAndReadsBound,
  assertAnAstralPairAtTheCutIsNotSplit,
  assertAnOverflowingSlugIsTruncatedAndHashed,
  assertAPartlyResolvedWidgetReportsPartial,
  assertAWidgetWhoseKeysAllMissIsStillPlanned,
  assertAWidgetWithNoPointKeysReportsBound,
  assertEveryHostileInputProducesAContractShapedSlug,
  assertOmittedFeaturedIsZeroWhenTheViewHasWidgets,
  assertPlannedWidgetsCopyTheTemplateVerbatim,
  assertSlugDropsNonAsciiAndCollapsesRuns,
  assertSlugJoinsTheLowerCasedCodeAndView,
  assertTheBatchBoundAcceptsTheLimitAndRefusesOneMore,
  assertTheBatchBoundThrowsABadRequest,
  assertTheFallbackBindsOneKeyPerTileByVocabulary,
  assertTheFallbackStopsAtTheWidgetCapAndReportsTheOmitted,
  assertTheFeaturedFallbackLaysTilesOnTheLattice,
  assertTheNameIsCutToTwoHundredFiftyFiveCodePoints,
  assertTheReportCarriesNoRolesAndOneMatchedMember,
  assertTwoInputsDifferingPastTheCutGetDifferentSlugs,
  assertWidgetKeysAreTheViewAndIndexAndUnique,
  assertWidgetRowsCountsTheFallbackAndTheWidgets,
} from "./asset-dashboards-plan.spec";

/** `F3.2` Task 5 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.2 — the per-asset dashboard plan (ADR 0067)", () => {
  describe("dashboardSlug (D2)", () => {
    it("P1: joins the lower-cased asset code and view name", () => {
      assertSlugJoinsTheLowerCasedCodeAndView();
    });

    it("P2: drops every code point outside the class and collapses the runs", () => {
      assertSlugDropsNonAsciiAndCollapsesRuns();
    });

    it("P3: truncates to 55 and appends eight lower-case hex, landing on 64", () => {
      assertAnOverflowingSlugIsTruncatedAndHashed();
    });

    it("P3: two inputs differing only past the cut get different slugs", () => {
      assertTwoInputsDifferingPastTheCutGetDifferentSlugs();
    });

    it("P4: pads a degenerate pair up to the two-character floor", () => {
      assertADegenerateSlugIsPaddedToTwoCharacters();
    });

    it("P5: produces a slug the column and the path segment accept, for every hostile input", () => {
      assertEveryHostileInputProducesAContractShapedSlug();
    });
  });

  describe("dashboardName (D3)", () => {
    it("P6: cuts to 255 code points, which is what varchar(255) counts", () => {
      assertTheNameIsCutToTwoHundredFiftyFiveCodePoints();
    });

    it("P6: does not split an astral pair sitting on the cut", () => {
      assertAnAstralPairAtTheCutIsNotSplit();
    });
  });

  describe("planView, a view with its own widgets (D4)", () => {
    it("P7: copies title, layout, type and config verbatim and binds in key order", () => {
      assertPlannedWidgetsCopyTheTemplateVerbatim();
    });

    it("P7: a chart binds series and every other type binds a primary point", () => {
      assertAChartBindsSeriesAndATilePrimary();
    });

    it("P7: a widget whose keys partly resolve is planned with fewer points and reads partial", () => {
      assertAPartlyResolvedWidgetReportsPartial();
    });

    it("P7: a widget whose keys all miss is still planned, and reads unresolved", () => {
      assertAWidgetWhoseKeysAllMissIsStillPlanned();
    });

    it("P7b: a tile that declares no point key is short of nothing, and reads bound", () => {
      assertAWidgetWithNoPointKeysReportsBound();
    });

    it("P7: the report carries no role codes and exactly one matched member", () => {
      assertTheReportCarriesNoRolesAndOneMatchedMember();
    });
  });

  describe("planView, the featured fallback (D4)", () => {
    it("P8: lays one value tile per featured key, four to a row", () => {
      assertTheFeaturedFallbackLaysTilesOnTheLattice();
    });

    it("P8: binds one key per tile, which is the vocabulary's own cardinality", () => {
      assertTheFallbackBindsOneKeyPerTileByVocabulary();
    });

    it("P9: stops at the dashboard's widget cap and counts the keys it dropped", () => {
      assertTheFallbackStopsAtTheWidgetCapAndReportsTheOmitted();
    });

    it("P9: reports nothing omitted when the view carries its own widgets", () => {
      assertOmittedFeaturedIsZeroWhenTheViewHasWidgets();
    });

    it("P10: keys every resolution as `<view>#<index>`, unique within the view", () => {
      assertWidgetKeysAreTheViewAndIndexAndUnique();
    });
  });

  describe("a widget that repeats a point key (code review #1)", () => {
    it("P13: plans one binding per distinct key and reads bound", () => {
      assertARepeatedPointKeyBindsOnceAndReadsBound();
    });

    it("P13: still reads unresolved when the repeated key names no point", () => {
      assertARepeatedMissingKeyReadsUnresolved();
    });
  });

  describe("the batch bound (D7)", () => {
    it("P11: counts a capped fallback and an authored widget list alike", () => {
      assertWidgetRowsCountsTheFallbackAndTheWidgets();
    });

    it("P12: accepts the limit and refuses one row over it, naming both numbers", () => {
      assertTheBatchBoundAcceptsTheLimitAndRefusesOneMore();
    });

    it("P12: refuses with the API's 400 rather than a bare Error", () => {
      assertTheBatchBoundThrowsABadRequest();
    });
  });
});
