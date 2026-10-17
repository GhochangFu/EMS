import { describe, it } from "vitest";

import * as T from "./copilot-turn-attachments.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 7 — a turn that carries files (ADR 0099 Amendment 3 A4–A7)", () => {
  it("(1) a PNG reaches the provider as a part and is not stored", () => T.aPngReachesTheProviderAsAPartAndIsNotStored());
  it("(2) A7: a file turn offers no access tool", () => T.aFileTurnOffersNoAccessTool());
  it("(2b) D8: a file turn without asset words offers no asset create", () => T.aFileTurnWithoutAssetWordsOffersNoAssetCreate());
  it("(2c) D8: a file turn with asset words offers the creates", () => T.aFileTurnWithAssetWordsOffersTheCreates());
  it("(3b) D11: a turn after a file tells its tools the history has one", () => T.aTurnAfterAFileTellsItsToolsTheHistoryHasOne());
  it("D11: the history scan stops at the last layout outcome", () => T.theHistoryScanStopsAtTheLastLayoutOutcome());
  it("a file turn hands its files to its tools", () => T.aFileTurnHandsItsFilesToItsTools());
  it("D5: a provider error without a file keeps the plain reply", () => T.aProviderErrorWithoutAFileKeepsThePlainReply());
  it("a message ending in a colon keeps its placeholder", () => T.aMessageEndingInAColonKeepsItsPlaceholder());
  it("(4) A6: a layout follow-up offers binding by ids", () => T.aLayoutFollowUpOffersBindingByIds());
  it("A6: another follow-up offers no binding", () => T.anotherFollowUpOffersNoBinding());
  it("(5) A4: a file in a skill is 400 and not counted", () => T.aFileInASkillIs400AndNotCounted());
  it("(6) A7: the switch off is 403 and not counted", () => T.theSwitchOffIs403AndNotCounted());
  it("(7) D1: no key is 400 before the switch", () => T.noKeyIs400BeforeTheSwitch());
  it("(8) D2: a cross-organization file is 400", () => T.aCrossOrganizationFileIs400());
  it("a refused file is its status and not counted", () => T.aRefusedFileIsItsStatusAndNotCounted());
  it("(9) D5: a provider error on a file turn is the unreadable reply", () => T.aProviderErrorOnAFileTurnIsTheUnreadableReply());
  it("(9b) D5: a cap on a file turn keeps the plain reply", () => T.aCapOnAFileTurnKeepsThePlainReply());
  it("(10) an SVG is text, never a part", () => T.anSvgIsTextNeverAPart());
  it("(11) D13: a hostile filename stays quoted on one line", () => T.aHostileFilenameStaysQuotedOnOneLine());
  it("(11b) D13: a filename with a newline is 400 at the turn", () => T.aFilenameWithANewlineIs400AtTheTurn());
});

describe("F4.267 — an image turn resolves the vision model (ADR 0090 Amendment 3 C3)", () => {
  it("a PNG turn asks for the image model and that provider answers", () => T.anImageTurnResolvesTheVisionModel());
  it("a PDF-only turn stays on the main model", () => T.aPdfOnlyTurnResolvesTheMainModel());
  it("an SVG-only turn stays on the main model", () => T.anSvgOnlyTurnResolvesTheMainModel());
  it("a PNG beside a PDF goes to the image model with the PDF part", () => T.aPngBesideAPdfGoesToTheVisionModelWithThePdf());
  it("a text turn asks for no image", () => T.aTextTurnAsksForNoImage());
  it("the turn log names the vision model and carries no key", () => T.theTurnLogNamesTheVisionModel());
  it("no key is still 400 before the switch on an image turn", () => T.noKeyIsStill400BeforeTheSwitchOnAnImageTurn());
});

describe("F4.268 — a drawing sent as a PDF (ADR 0090 Amendment 3 ruling 6)", () => {
  it("a PDF-only turn carries the text-only clause", () => T.aPdfOnlyTurnCarriesThePdfTextOnlyClause());
  it("a PDF beside an image carries no clause", () => T.aPdfBesideAnImageCarriesNoPdfClause());
  it("an image turn carries no clause", () => T.anImageTurnCarriesNoPdfClause());
  it("a text turn carries no clause", () => T.aTextTurnCarriesNoPdfClause());
  it("a provider error on a PDF-only turn appends the image rule", () => T.aProviderErrorOnAPdfTurnAppendsThePdfNote());
  it("the deadline on a PDF-only turn appends the image rule", () => T.aDeadlineOnAPdfTurnAppendsThePdfNote());
  it("the deadline on a text turn keeps the plain reply", () => T.aDeadlineOnATextTurnKeepsThePlainReply());
  it("the call cap on a PDF-only turn keeps the plain reply", () => T.aCallCapOnAPdfTurnKeepsThePlainReply());
  it("a provider error on an image turn keeps the unreadable reply alone", () => T.aProviderErrorOnAnImageTurnKeepsTheUnreadableReplyAlone());
});
