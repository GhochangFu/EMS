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
