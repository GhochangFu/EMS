// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { resetCopilotStore } from "../../stores/copilot-store";

import {
  editPrefillsTheCurrencyAndSendsIt,
  formHasACurrencyInputWithADatalist,
  formHasATimezoneInputOfferingUtc,
  listRendersTheCurrencyColumn,
  listRendersTheTimezoneColumnAndEditPrefills,
  typedTimezoneIsSubmittedOnCreate,
  untouchedTimezoneSendsUtc,
  saveAnnouncesSavingWhilePending,
  saveIsNamedSaveAndNotBusyAtIdle,
  saveLosesItsIdleNameWhilePending,
  theAiAssistantActionIsHiddenWithoutAccess,
  theAiAssistantActionNavigatesToTheSubPage,
  typedCurrencyIsUppercasedAndSubmitted,
  aRefusedRowSwitchShowsTheSentence,
  aRefusedAttachmentSwitchShowsTheSentence,
  theGlobalAdminSwitchesARowsAttachmentsOn,
  onboardWithAiFilesTheDocksRequestAndDoesNotNavigate,
  onboardWithAiIsAbsentForAnOrganizationAdminWhoseCopilotIsOff,
  onboardWithAiShowsForAnOrganizationAdminWhoseCopilotIsOn,
  aRefusedSaveShowsTheSentence,
  theCopilotSwitchIsAbsentForEveryoneButTheGlobalAdmin,
  theGlobalAdminSwitchesARowsCopilotOn,
} from "./organizations-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2). The project
 * default stays `node`.
 */
describe("E4.1c organizations page — the Currency field", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetCopilotStore();
  });

  it("O1 the form has a Currency input bound to a datalist with at least one option", async () => {
    await formHasACurrencyInputWithADatalist();
  });

  it("O2 a typed inr is submitted as currency: INR", async () => {
    await typedCurrencyIsUppercasedAndSubmitted();
  });

  it("O3 the list has a Currency column carrying each row's code", async () => {
    await listRendersTheCurrencyColumn();
  });

  it("O4 editing a row prefills the Currency input and the update sends it", async () => {
    await editPrefillsTheCurrencyAndSendsIt();
  });

  it("F3.85 Z1 the form has a required Time zone input whose datalist offers UTC first", async () => {
    await formHasATimezoneInputOfferingUtc();
  });

  it("F3.85 Z2 a typed zone is submitted on create", async () => {
    await typedTimezoneIsSubmittedOnCreate();
  });

  it("F3.85 Z3 an untouched zone sends UTC", async () => {
    await untouchedTimezoneSendsUtc();
  });

  it("F3.85 Z4 the list carries each row's zone and edit prefills it", async () => {
    await listRendersTheTimezoneColumnAndEditPrefills();
  });

  it("B1 Save is named Save and not busy at idle", async () => {
    await saveIsNamedSaveAndNotBusyAtIdle();
  });

  it("B1 Save announces Saving… with aria-busy while pending", async () => {
    await saveAnnouncesSavingWhilePending();
  });

  it("B1 the idle name Save is gone while pending", async () => {
    await saveLosesItsIdleNameWhilePending();
  });

  it("F3.21 the AI assistant action opens the row's sub-page for an organization_admin", async () => {
    await theAiAssistantActionNavigatesToTheSubPage();
  });

  it("F3.21 the AI assistant action is hidden from a role without access", async () => {
    await theAiAssistantActionIsHiddenWithoutAccess();
  });

  it("F4.204 a refused save shows the sentence, not the envelope", async () => {
    await aRefusedSaveShowsTheSentence();
  });

  it("F3.85 the global admin switches a row's copilot on", async () => {
    await theGlobalAdminSwitchesARowsCopilotOn();
  });

  it("F3.85 the copilot switch is absent for everyone but the global admin", async () => {
    await theCopilotSwitchIsAbsentForEveryoneButTheGlobalAdmin();
  });

  it("F3.85 a refused row switch shows the server sentence", async () => {
    await aRefusedRowSwitchShowsTheSentence();
  });

  it("F3.87 the global admin switches a row's attachments on", async () => {
    await theGlobalAdminSwitchesARowsAttachmentsOn();
  });

  it("F3.87 a refused attachment switch shows the server sentence", async () => {
    await aRefusedAttachmentSwitchShowsTheSentence();
  });

  it("F3.86 PR 7 Onboard with AI files the dock's request and does not navigate", async () => {
    await onboardWithAiFilesTheDocksRequestAndDoesNotNavigate();
  });

  it("F3.86 PR 7 Onboard with AI is absent for an organization_admin whose copilot is off", async () => {
    await onboardWithAiIsAbsentForAnOrganizationAdminWhoseCopilotIsOff();
  });

  it("F3.86 PR 7 Onboard with AI shows for an organization_admin whose copilot is on", async () => {
    await onboardWithAiShowsForAnOrganizationAdminWhoseCopilotIsOn();
  });
});
