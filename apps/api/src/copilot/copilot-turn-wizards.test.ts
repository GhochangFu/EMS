import { describe, it } from "vitest";

import {
  aFillAfterOpenPageInOneTurnIsAccepted,
  anOpenRecordsOrganizationIsTheReplysProvenance,
  aTurnWithoutTheOpenWizardGetsNoFill,
  aTurnWithTheOpenWizardGetsTheFill,
  theModelIsToldWhichRecordsAreOpen,
  theOpenPageResultNamesThePagesRecords,
} from "./copilot-turn-wizards.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.245 — a turn's open wizards reach the tools and the model (ADR 0099 Amendment 4)", () => {
  it("gives the fill for the open record", () => aTurnWithTheOpenWizardGetsTheFill());
  it("gives no fill when that record is not open", () => aTurnWithoutTheOpenWizardGetsNoFill());
  it("tells the model which records are open", () => theModelIsToldWhichRecordsAreOpen());
  it("records an open record's organization as the reply's provenance", () => anOpenRecordsOrganizationIsTheReplysProvenance());
  it("accepts a fill after open_page in one turn", () => aFillAfterOpenPageInOneTurnIsAccepted());
  it("names the opened page's records in the open_page result", () => theOpenPageResultNamesThePagesRecords());
});
