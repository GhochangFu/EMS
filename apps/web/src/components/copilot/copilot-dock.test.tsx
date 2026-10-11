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
  showsNoButtonOnTheOnboardingChat,
  showsNoButtonToAnOperator,
  showsNoButtonWhenTheStatusIsUnavailable,
  showsTheButtonOnAnotherOrganizationPage,
  showsTheButtonToAnAdminWhenAvailable,
  showsTheMockupsBotMarkOnTheButton,
  showsTheInputWhenConfigured,
  showsTheSentenceAndNoInputWhenNotConfigured,
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
  it("shows no button on the onboarding chat", showsNoButtonOnTheOnboardingChat);
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
