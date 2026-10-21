// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  aBodylessRouteIsReviewAlone,
  aCleanPageLeavesAtOnce,
  aDirtyPageAsksBeforeLeaving,
  aFillForAnotherRecordIsNotTaken,
  aFillForThisEntryFillsItsStep,
  aMountedWizardRegistersItsRecord,
  aFillThatSetsNothingLeavesTheWizardClean,
  aPageFixedFieldIsNotFilled,
  aWizardThatDoesNotNameItsRecordSaysSo,
  aSelectFirstPickReachesThePage,
  aSelectFirstPickStaysPicked,
  aSelectPickArmsTheLeavePrompt,
  cancelAsksBeforeLeavingAChangedWizard,
  cancelAsksOnlyWhenChanged,
  nextStaysOnAWrongStep,
  reviewRefusesABodyTheRouteWouldRefuse,
  reviewShowsATemplatePointsFormulaRow,
  reviewSubmitsThePlainBody,
  showsTheEntrysStepsThenReview,
} from "./wizard-shell.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetWizardStore();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). */
describe("F3.85 PR 8 wizard shell — every catalog route is a stepper (ADR 0099 decision 6, ruling Q6)", () => {
  it("shows the entry's steps, then Review", () => showsTheEntrysStepsThenReview());
  it("stays on a step whose fields are wrong", () => nextStaysOnAWrongStep());
  it("submits the plain body from Review, never through the copilot", () => reviewSubmitsThePlainBody());
  it("does not submit a body the route would refuse", () => reviewRefusesABodyTheRouteWouldRefuse());
  it("F4.246: shows a template point's formula row on Review", () => reviewShowsATemplatePointsFormulaRow());
  it("is the Review step alone for a bodyless route", () => aBodylessRouteIsReviewAlone());
  it("takes a copilot fill for its own entry only", () => aFillForThisEntryFillsItsStep());
  it("F4.245: never takes another record's fill, and takes its own", () => aFillForAnotherRecordIsNotTaken());
  it("F4.245: registers its record while mounted", () => aMountedWizardRegistersItsRecord());
  it("F4.245: says so when it does not name its record", () => aWizardThatDoesNotNameItsRecordSaysSo());
  it("F4.245: never fills a page-fixed field", () => aPageFixedFieldIsNotFilled());
  it("F4.245 C2: a fill that sets no field leaves the wizard clean", () => aFillThatSetsNothingLeavesTheWizardClean());
  it("leaves a clean wizard at once", () => cancelAsksOnlyWhenChanged());
  it("asks before leaving a changed wizard", () => cancelAsksBeforeLeavingAChangedWizard());
  it("gives the page the new value of a select-first pick", () => aSelectFirstPickReachesThePage());
  it("keeps a select-first pick on display and in the values", () => aSelectFirstPickStaysPicked());
  it("asks before leaving after a select pick", () => aSelectPickArmsTheLeavePrompt());
  it("asks before leaving when the page says it is dirty", () => aDirtyPageAsksBeforeLeaving());
  it("leaves at once when the page says it is clean and nothing was typed", () => aCleanPageLeavesAtOnce());
});
