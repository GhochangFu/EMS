// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import { resetCopilotStore } from "../../stores/copilot-store";
import {
  bannersACredentialRefusalAndDoesNotRestoreTheInput,
  keepsTheThreadAndThePickAcrossAnOpenPageNavigation,
  startsAfreshForAnotherUser,
  bindsTheGlobalAdminsConversationToThePickedOrganization,
  formatsTheResetInTheUsersLocale,
  ignoresANavigateToThatIsNotAnAppRoute,
  mountsTheDockInTheAppShell,
  navigatesThroughTheRouterOnOpenPage,
  offersAScopedAdminNoPicker,
  offersTheGlobalAdminThePlatformScopeByDefault,
  opensFromTheRememberedState,
  remembersTheOpenState,
  rendersTheResetTimeOnA429,
  sendsTheTypedTextAndRendersTheReply,
  showsNoButtonToAnOperator,
  showsNoButtonWhenTheStatusIsUnavailable,
  showsTheButtonOnAnotherOrganizationPage,
  showsTheButtonToAnAdminWhenAvailable,
  showsTheMockupsBotMarkOnTheButton,
  showsTheInputWhenConfigured,
  showsTheSentenceAndNoInputWhenNotConfigured,
  clearsTheChipsAfterTheTurnIsAnswered,
  namesThePickedOrganizationInTheSentence,
  offersAttachInAConversationBoundToTheOrganization,
  offersAttachWithTheUnscrubbedSentence,
  offersNoAttachInACrossOrganizationConversation,
  offersNoAttachInTheGuidedMode,
  offersNoAttachOnThePlatformScope,
  offersNoAttachWhileASkillIsActive,
  offersNoAttachWithNoKey,
  offersNoAttachWithTheSwitchOff,
  refusesAFileOverTenMegabytes,
  refusesAFileTypeNotInTheList,
  refusesAFourthFile,
  refusesAnSvgOverSixtyFourKilobytes,
  removesAChip,
  rendersAPlainUserRowWithNoRecord,
  rendersThePlaceholderLinesAsAMutedRecord,
  sendsAPlainTurnWithoutAFileList,
  sendsTheChosenFilesAsFormData,
  showsAChipPerChosenFile,
} from "./copilot-dock.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ scope: null });
  resetCopilotStore();
  window.localStorage.clear();
});

describe("F3.85 PR 7 copilot dock — who sees the button", () => {
  it("shows the button to an admin when the status is available", showsTheButtonToAnAdminWhenAvailable);
  it("shows the mockup's bot mark on the button", showsTheMockupsBotMarkOnTheButton);
  it("shows no button to an operator, and never asks for the status", showsNoButtonToAnOperator);
  it("shows no button when the status is unavailable", showsNoButtonWhenTheStatusIsUnavailable);
  it("shows the button on another organization page", showsTheButtonOnAnotherOrganizationPage);
  it("is mounted by the real AppShell", mountsTheDockInTheAppShell);
});

describe("F3.85 PR 7 copilot dock — a turn", () => {
  it("sends the typed text and renders the reply", sendsTheTypedTextAndRendersTheReply);
  it("renders the reset time on a 429", rendersTheResetTimeOnA429);
  it("formats the reset time in the user's locale", formatsTheResetInTheUsersLocale);
  it("navigates through the router on open_page", navigatesThroughTheRouterOnOpenPage);
  it("ignores a navigateTo that is not an app route", ignoresANavigateToThatIsNotAnAppRoute);
  it("banners a credential refusal and does not restore the input", bannersACredentialRefusalAndDoesNotRestoreTheInput);
});

describe("F3.85 PR 7 copilot dock — configured", () => {
  it("shows the sentence and no input when not configured", showsTheSentenceAndNoInputWhenNotConfigured);
  it("shows the input when configured", showsTheInputWhenConfigured);
});

describe("F3.85 PR 7 copilot dock — open state and scope", () => {
  it("remembers the open state in localStorage", remembersTheOpenState);
  it("opens from the remembered state", opensFromTheRememberedState);
  it("offers the global admin the platform scope by default", offersTheGlobalAdminThePlatformScopeByDefault);
  it("binds the global admin's conversation to the picked organization", bindsTheGlobalAdminsConversationToThePickedOrganization);
  it("offers a scoped admin no picker", offersAScopedAdminNoPicker);
});

describe("F3.85 PR 7 copilot dock — the session survives a route change", () => {
  it("keeps the thread and the pick across an open_page navigation", keepsTheThreadAndThePickAcrossAnOpenPageNavigation);
  it("starts afresh for another user", startsAfreshForAnotherUser);
});

describe("F3.87 PR 8 copilot dock — the attach control is absent (Amendment 3 A4, A7; plan D2)", () => {
  it("in the guided mode (a skill with no AI key)", offersNoAttachInTheGuidedMode);
  it("with no AI key", offersNoAttachWithNoKey);
  it("with the organization's attachment switch off", offersNoAttachWithTheSwitchOff);
  it("while a skill is active", offersNoAttachWhileASkillIsActive);
  it("in a cross-organization conversation", offersNoAttachInACrossOrganizationConversation);
  it("on the global admin's platform scope", offersNoAttachOnThePlatformScope);
});

describe("F3.87 PR 8 copilot dock — the attach control is present", () => {
  it("says the file goes to the organization's AI provider unscrubbed", offersAttachWithTheUnscrubbedSentence);
  it("in a remembered conversation bound to the organization", offersAttachInAConversationBoundToTheOrganization);
  it("names the global admin's picked organization", namesThePickedOrganizationInTheSentence);
});

describe("F3.87 PR 8 copilot dock — the picker's client checks and chips", () => {
  it("shows a chip per chosen file", showsAChipPerChosenFile);
  it("refuses a fourth file", refusesAFourthFile);
  it("refuses a file type not in the list", refusesAFileTypeNotInTheList);
  it("refuses a file over 10 MB", refusesAFileOverTenMegabytes);
  it("refuses an .svg over 64 KB", refusesAnSvgOverSixtyFourKilobytes);
  it("removes a chip", removesAChip);
});

describe("F3.87 PR 8 copilot dock — sending files and the record they leave", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the chosen files as FormData through sendCopilotTurn", sendsTheChosenFilesAsFormData);
  it("clears the chips after the turn is answered", clearsTheChipsAfterTheTurnIsAnswered);
  it("sends a plain turn without a file list", sendsAPlainTurnWithoutAFileList);
  it("renders the placeholder lines as a muted record", rendersThePlaceholderLinesAsAMutedRecord);
  it("renders a plain user row with no record", rendersAPlainUserRowWithNoRecord);
});
