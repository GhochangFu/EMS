import { describe, it } from "vitest";

import {
  aFillAfterOpenPageForTheCurrentPagesWizardIsRefused,
  aFillAfterOpenPageInOneTurnIsAccepted,
  anOpenPageAfterAFillDropsTheFill,
  anOpenPageThatMountsTheFilledRecordKeepsTheFill,
  anOpenRecordsOrganizationIsTheReplysProvenance,
  onlyTheLastOpenedPageAdmitsAFill,
  theNamesBlockCarriesTheRecordsName,
  theOpenRecordsNamesComeAsUserRoleData,
  aTurnWithoutTheOpenWizardGetsNoFill,
  aTurnWithTheOpenWizardGetsTheFill,
  theModelIsToldWhichRecordsAreOpen,
  theOpenPageResultNamesThePagesRecords,
  theOpenPageResultSaysTheFillWasDropped,
  theRefusalAfterOpenPageNamesTheOpenedPage,
} from "./copilot-turn-wizards.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.245 — a turn's open wizards reach the tools and the model (ADR 0099 Amendment 4)", () => {
  it("gives the fill for the open record", () => aTurnWithTheOpenWizardGetsTheFill());
  it("gives no fill when that record is not open", () => aTurnWithoutTheOpenWizardGetsNoFill());
  it("tells the model which records are open", () => theModelIsToldWhichRecordsAreOpen());
  it("L3: sends the open records' names as user-role data", () => theOpenRecordsNamesComeAsUserRoleData());
  it("L3: names the open record, quoted, in that block", () => theNamesBlockCarriesTheRecordsName());
  it("records an open record's organization as the reply's provenance", () => anOpenRecordsOrganizationIsTheReplysProvenance());
  it("accepts a fill after open_page in one turn", () => aFillAfterOpenPageInOneTurnIsAccepted());
  it("C3: admits a fill only for the last page the turn opened", () => onlyTheLastOpenedPageAdmitsAFill());
  it("names the opened page's records in the open_page result", () => theOpenPageResultNamesThePagesRecords());
  it("refuses a fill for the current page's wizard after open_page", () => aFillAfterOpenPageForTheCurrentPagesWizardIsRefused());
  it("names the opened page in that refusal", () => theRefusalAfterOpenPageNamesTheOpenedPage());
  it("drops a fill for the current page's wizard at a later open_page", () => anOpenPageAfterAFillDropsTheFill());
  it("tells the model in the open_page result that the fill was dropped", () => theOpenPageResultSaysTheFillWasDropped());
  it("keeps a fill whose record the opened page mounts", () => anOpenPageThatMountsTheFilledRecordKeepsTheFill());
});
