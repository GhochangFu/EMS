import { describe, it } from "vitest";

import {
  aCreateWizardWithNoParamsIsAccepted,
  aDuplicateRecordIsNamedOnce,
  aDuplicateWizardDoesNotFailTheTurn,
  aListPageMountsItsCreateWizard,
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
  theMessageNamesEachRecordAsData,
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
  it("maps a page without a wizard to none", () => aPageWithoutAWizardMountsNone());
  it("sends no message when no wizard is open", () => noOpenWizardSendsNoMessage());
  it("names each open record as quoted data", () => theMessageNamesEachRecordAsData());
  it("cuts a long record name", () => aLongNameIsCut());
  it("names a duplicate record once", () => aDuplicateRecordIsNamedOnce());
});
