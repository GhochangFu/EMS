import { describe, it } from "vitest";

import {
  aChoiceForAnUnknownTabIsRefused,
  aChoiceForTheOverviewIsRefused,
  aChoiceOfAGroupNotAtTheSiteIsRefused,
  aChoiceOfAnotherDomainIsRefused,
  aChoiceOfATakenGroupIsRefused,
  aDomainlessGroupNeverBindsTheOverview,
  aLaterTabTakesOnlyAnUntakenGroup,
  aSiteWithNoGroupGetsOneGroupPerDomain,
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
