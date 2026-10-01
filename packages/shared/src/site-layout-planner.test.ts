import { describe, it } from "vitest";

import {
  aChoiceForAnUnknownTabIsRefused,
  aChoiceForTheOverviewIsRefused,
  aChoiceOfAGroupNotAtTheSiteIsRefused,
  aChoiceOfAnotherDomainIsRefused,
  aChoiceOfATakenGroupIsRefused,
  aDomainlessGroupNeverBindsTheOverview,
  aBoundTileAndEveryUnboundWidgetAreKept,
  aLaterTabTakesOnlyAnUntakenGroup,
  anEmptiedRowLiftsTheRowsBelowIt,
  aPackedRowStepsAroundATallWidgetFromAbove,
  aPackedTallWidgetStepsAroundAWidgetBelow,
  aRowThatKeepsAWidgetLiftsNothing,
  aRowWithNoRemovalKeepsItsGaps,
  aSiteWithNoGroupGetsOneGroupPerDomain,
  aSourceTileWithNoRoleIsKept,
  aTabThatLosesEveryTileLiftsItsBody,
  aTileWhoseMemberLacksThePointKeyIsOmitted,
  aTileWhoseRoleHasNoMemberIsOmitted,
  csmocOverviewPacksTheKeptCardsLeftInTemplateOrder,
  packingNeverMovesTheTemplatesOwnCards,
  pheOverviewPacksTheKeptCardsLeft,
  theKeptTilesArePackedLeft,
  theSmocOverviewHasNoCardToDrop,
  csmocWithoutAChoiceBindsEachTabByGroupCode,
  csmocWithoutAChoiceHasTheSameFiveTabs,
  csmocWithTheSeedChoiceBindsByChoice,
  csmocWithTheSeedChoiceHasFiveTabs,
  domainsPresentIsSortedUniqueAndNonNull,
  ionxShapeCreatesNoGroup,
  ionxShapeKeepsOverviewAndWater,
  pheOverviewKeepsExactlyTheSldAndEnvCards,
  pheReportsTheFourDroppedCards,
  pheShapeKeepsOverviewSldAndEnv,
  pheShapeOmitsTheFourAbsentDomains,
  twoCandidatesWithNoGroupCodeMatchAreAmbiguous,
} from "./site-layout-planner.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.73 — the site-layout planner (plan D5)", () => {
  it("keeps overview, sld and env on a PHE pump station", () => {
    pheShapeKeepsOverviewSldAndEnv();
  });
  it("omits ups, hvac, it and water on a PHE pump station", () => {
    pheShapeOmitsTheFourAbsentDomains();
  });
  it("keeps exactly the sld and env module cards on the PHE Overview", () => {
    pheOverviewKeepsExactlyTheSldAndEnvCards();
  });
  it("reports the four PHE module cards it drops", () => {
    pheReportsTheFourDroppedCards();
  });
  it("drops no card from the v3 SMOC Overview on a PHE pump station (F3.77)", () => {
    theSmocOverviewHasNoCardToDrop();
  });
  it("plans overview, sld, ups, hvac and water on CSMOC with the seed choice", () => {
    csmocWithTheSeedChoiceHasFiveTabs();
  });
  it("plans the same five CSMOC tabs with no choice", () => {
    csmocWithoutAChoiceHasTheSameFiveTabs();
  });
  it("binds the CSMOC tabs by groupCode when no choice is given", () => {
    csmocWithoutAChoiceBindsEachTabByGroupCode();
  });
  it("binds the three chosen CSMOC tabs by the choice", () => {
    csmocWithTheSeedChoiceBindsByChoice();
  });
  it("never binds a domain-less group to the Overview", () => {
    aDomainlessGroupNeverBindsTheOverview();
  });
  it("reports sld as ambiguous with both candidates", () => {
    twoCandidatesWithNoGroupCodeMatchAreAmbiguous();
  });
  it("refuses a choice of another domain's group", () => {
    aChoiceOfAnotherDomainIsRefused();
  });
  it("refuses a choice of a group another choice took", () => {
    aChoiceOfATakenGroupIsRefused();
  });
  it("refuses a choice of a group not at the site", () => {
    aChoiceOfAGroupNotAtTheSiteIsRefused();
  });
  it("refuses a choice for the Overview", () => {
    aChoiceForTheOverviewIsRefused();
  });
  it("refuses a choice for a tab the template does not have", () => {
    aChoiceForAnUnknownTabIsRefused();
  });
  it("gives a later tab only an untaken group", () => {
    aLaterTabTakesOnlyAnUntakenGroup();
  });
  it("keeps overview and water on IONX-DEMO", () => {
    ionxShapeKeepsOverviewAndWater();
  });
  it("creates no group on IONX-DEMO, which has one", () => {
    ionxShapeCreatesNoGroup();
  });
  it("creates one group per domain on a site with none", () => {
    aSiteWithNoGroupGetsOneGroupPerDomain();
  });
  it("lists the domains present, sorted, unique and non-null", () => {
    domainsPresentIsSortedUniqueAndNonNull();
  });
});

describe("F3.73 — packing a copy left when the plan removes widgets", () => {
  it("packs the two PHE Overview cards left", () => {
    pheOverviewPacksTheKeptCardsLeft();
  });
  it("packs the four CSMOC Overview cards left in template order", () => {
    csmocOverviewPacksTheKeptCardsLeftInTemplateOrder();
  });
  it("never moves the template's own cards", () => {
    packingNeverMovesTheTemplatesOwnCards();
  });
  it("keeps the gaps of a row nothing was removed from", () => {
    aRowWithNoRemovalKeepsItsGaps();
  });
  it("lifts the rows below a row that lost every widget", () => {
    anEmptiedRowLiftsTheRowsBelowIt();
  });
  it("lifts nothing below a row that keeps a widget", () => {
    aRowThatKeepsAWidgetLiftsNothing();
  });
  it("packs a row around a tall widget from a higher row", () => {
    aPackedRowStepsAroundATallWidgetFromAbove();
  });
  it("never packs a tall widget over a widget in a lower row", () => {
    aPackedTallWidgetStepsAroundAWidgetBelow();
  });
});

describe("F3.73 — role tiles with no point at the site are omitted", () => {
  it("omits a tile whose role has no member", () => {
    aTileWhoseRoleHasNoMemberIsOmitted();
  });
  it("omits a tile whose member lacks the point key", () => {
    aTileWhoseMemberLacksThePointKeyIsOmitted();
  });
  it("keeps a bound tile and every widget with no role", () => {
    aBoundTileAndEveryUnboundWidgetAreKept();
  });
  it("keeps a catalog-source tile", () => {
    aSourceTileWithNoRoleIsKept();
  });
  it("packs the kept tiles left", () => {
    theKeptTilesArePackedLeft();
  });
  it("lifts the tab's body when every tile is omitted", () => {
    aTabThatLosesEveryTileLiftsItsBody();
  });
});
