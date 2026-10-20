import { describe, it } from "vitest";

import {
  aCreateIsOpenWithoutARead,
  aFillForAnotherRecordIsRefused,
  aFillForAnotherRecordThanThePagesIsRefused,
  aFillForAPageThisTurnOpenedIsAccepted,
  aFillForTheOpenRecordCarriesItsParams,
  aFillWithNoOpenWizardIsRefused,
  anInScopeRecordIsOpenWithItsName,
  anOnboardingWizardIsNeverOpen,
  anUnknownSlugNamesNoWizard,
  aPageRecordOutsideTheScopeIsNotNamed,
  aRecordOfAnotherOrganizationIsNotOpen,
  aRecordOutsideTheAllowedSetIsNotOpen,
  aRecordTheResolverRefusesIsNotOpen,
  theDashboardEditPageNamesItsRecordBySlug,
  theFillDefinitionRequiresTheParams,
  twoOpenWizardsOfOneRecordRefuseTheFill,
} from "./copilot-propose-fill.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.245 — fill_step names its record and the server checks it (ADR 0099 Amendment 4)", () => {
  it("refuses a fill with no open wizard", () => aFillWithNoOpenWizardIsRefused());
  it("puts the named open record's params on the fill", () => aFillForTheOpenRecordCarriesItsParams());
  it("refuses a fill for A while only B is open", () => aFillForAnotherRecordIsRefused());
  it("refuses a fill for a record open twice", () => twoOpenWizardsOfOneRecordRefuseTheFill());
  it("accepts a fill for the record a page this turn opened shows", () => aFillForAPageThisTurnOpenedIsAccepted());
  it("refuses a fill for another record than the opened page's", () => aFillForAnotherRecordThanThePagesIsRefused());
  it("requires params in the fill_step definition", () => theFillDefinitionRequiresTheParams());
  it("opens an in-scope record with the resolver's name", () => anInScopeRecordIsOpenWithItsName());
  it("does not open a record of another organization than the bound one", () => aRecordOfAnotherOrganizationIsNotOpen());
  it("does not open a record outside the allowed set", () => aRecordOutsideTheAllowedSetIsNotOpen());
  it("does not open a record the resolver refuses", () => aRecordTheResolverRefusesIsNotOpen());
  it("opens a create without a read", () => aCreateIsOpenWithoutARead());
  it("never opens an onboarding wizard", () => anOnboardingWizardIsNeverOpen());
  it("names the dashboard edit page's record by its slug", () => theDashboardEditPageNamesItsRecordBySlug());
  it("names no wizard for an unknown slug", () => anUnknownSlugNamesNoWizard());
  it("does not name a page record outside the scope", () => aPageRecordOutsideTheScopeIsNotNamed());
});
