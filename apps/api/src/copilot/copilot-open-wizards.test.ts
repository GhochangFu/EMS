import { describe, it } from "vitest";

import {
  aBuiltInLibraryCodeIsAccepted,
  aCreateWizardWithNoParamsIsAccepted,
  aCredentialAcrossTheCutIsWithheld,
  aCredentialShapedParamIsWithheldFromTheLine,
  aLibraryCodeOfFreeTextIsRefused,
  anOpenRecordIsResolvedByItsRowAlone,
  aRecordWithNoNameSendsNoNamesBlock,
  theNamesBlockQuotesEachNameAsData,
  theSystemLineCarriesNoRecordName,
  theSystemLineNamesEachRecordByItsParams,
  aDuplicateRecordIsNamedOnce,
  aDuplicateWizardDoesNotFailTheTurn,
  aListPageMountsItsCreateWizard,
  theRulesPageMountsItsCreateWizard,
  theChannelsPageMountsItsCreateWizard,
  theEscalationPageMountsItsWizards,
  theReportsPageMountsItsTwoCreates,
  theVocabularyPagesMountTheirCreateWizards,
  aLongNameIsCut,
  aMalformedMultipartFieldIsA400,
  aMissingPathParameterIsRefused,
  anAbsentMultipartFieldStaysAbsent,
  anEditWizardWithItsIdIsAccepted,
  anExtraPathParameterIsRefused,
  anUnknownEntryIsRefused,
  aMultipartFieldIsParsedAsJson,
  aPageWithoutAWizardMountsNone,
  aTemplatePageMountsItsWizardsForTheRoutesRecord,
  aTemplatePageWithANonUuidNamesNoWizard,
  aValueTheEntryRefusesIsRefused,
  noOpenWizardSendsNoMessage,
  theDashboardEditPageMountsItsTwoWizardsBySlug,
} from "./copilot-open-wizards.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.245 — the open-wizard context of a turn (ADR 0099 Amendment 4)", () => {
  it("accepts an edit wizard with its id", () => anEditWizardWithItsIdIsAccepted());
  it("accepts a create wizard with no params", () => aCreateWizardWithNoParamsIsAccepted());
  it("refuses a missing path parameter, naming the index", () => aMissingPathParameterIsRefused());
  it("refuses an extra path parameter", () => anExtraPathParameterIsRefused());
  it("refuses a value the entry's own schema refuses", () => aValueTheEntryRefusesIsRefused());
  it("refuses an unknown catalog entry", () => anUnknownEntryIsRefused());
  it("keeps a duplicate wizard rather than failing the turn", () => aDuplicateWizardDoesNotFailTheTurn());
  it("answers a malformed multipart field with a 400", () => aMalformedMultipartFieldIsA400());
  it("parses a multipart field as JSON", () => aMultipartFieldIsParsedAsJson());
  it("leaves an absent multipart field absent", () => anAbsentMultipartFieldStaysAbsent());
  it("maps the dashboard edit route to its two wizards by slug", () => theDashboardEditPageMountsItsTwoWizardsBySlug());
  it("maps a template route to its wizards for the route's record", () => aTemplatePageMountsItsWizardsForTheRoutesRecord());
  it("names no wizard for a route value the entry refuses", () => aTemplatePageWithANonUuidNamesNoWizard());
  it("maps a list route to its create wizard", () => aListPageMountsItsCreateWizard());
  it("maps the two vocabulary pages to their create wizards", () => theVocabularyPagesMountTheirCreateWizards());
  it("maps the Rule Engine page to its create wizard (F4.278)", () => theRulesPageMountsItsCreateWizard());
  it("maps the Channels page to its create wizard (F4.279)", () => theChannelsPageMountsItsCreateWizard());
  it("maps the Escalation page to its three wizards (F4.279)", () => theEscalationPageMountsItsWizards());
  it("maps the Reports page to its two creates (F4.280)", () => theReportsPageMountsItsTwoCreates());
  it("maps a page without a wizard to none", () => aPageWithoutAWizardMountsNone());
  it("sends no message when no wizard is open", () => noOpenWizardSendsNoMessage());
  it("names each open record by its params in the system line", () => theSystemLineNamesEachRecordByItsParams());
  it("L3: puts no record name on the system line", () => theSystemLineCarriesNoRecordName());
  it("L3: quotes each name as data in its own block", () => theNamesBlockQuotesEachNameAsData());
  it("sends no names block when no open record has a name", () => aRecordWithNoNameSendsNoNamesBlock());
  it("cuts a long record name", () => aLongNameIsCut());
  it("L1: withholds a credential that spans the cut", () => aCredentialAcrossTheCutIsWithheld());
  it("L2: withholds a credential-shaped param from the line", () => aCredentialShapedParamIsWithheldFromTheLine());
  it("L2: refuses a library code of free text", () => aLibraryCodeOfFreeTextIsRefused());
  it("L2: accepts a built-in library's code", () => aBuiltInLibraryCodeIsAccepted());
  it("names a duplicate record once", () => aDuplicateRecordIsNamedOnce());
  it("C1: resolves an open record by its row alone", () => anOpenRecordIsResolvedByItsRowAlone());
});
