// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { useAuthStore } from "../../stores/auth-store";
import { resetCopilotStore } from "../../stores/copilot-store";
import {
  aClosedChatsToggleControlsNothing,
  anOpenChatsToggleControlsTheDrawer,
  aSentTurnReadsTheListAgain,
  aStartLocksTheList,
  aStartReadsTheListAgain,
  dockedHidesTheListUntilTheToggle,
  floatingHidesTheListUntilTheToggle,
  floatingShowsTheListAfterTheToggle,
  maximizedHasNoChatsToggle,
  maximizedShowsTheListAsAColumn,
  newChatThenASendMakesAConversation,
  openingAListedChatClearsANotConfiguredAnswer,
  openingAListedChatPicksItsOrganization,
  openingAListedChatReadsIt,
} from "./copilot-dock-chats.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), one claim per `it()`. */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ scope: null });
  resetCopilotStore();
  window.localStorage.clear();
});

describe("F4.292 copilot dock chats — opening and starting a chat", () => {
  it("opening a listed chat reads it", openingAListedChatReadsIt);
  it("opening a listed chat picks its organization", openingAListedChatPicksItsOrganization);
  it("New chat then a send makes a conversation", newChatThenASendMakesAConversation);
  it("a sent turn reads the list again", aSentTurnReadsTheListAgain);
  it("opening a listed chat clears a not-configured answer (critic)", openingAListedChatClearsANotConfiguredAnswer);
  it("an onboarding start locks the list (review)", aStartLocksTheList);
  it("an onboarding start reads the list again (review)", aStartReadsTheListAgain);
});

describe("F4.292 copilot dock chats — where the list shows", () => {
  it("maximized shows the list as a column", maximizedShowsTheListAsAColumn);
  it("maximized has no Chats toggle", maximizedHasNoChatsToggle);
  it("floating hides the list until the toggle", floatingHidesTheListUntilTheToggle);
  it("floating shows the list after the toggle", floatingShowsTheListAfterTheToggle);
  it("docked hides the list until the toggle (critic)", dockedHidesTheListUntilTheToggle);
  it("a closed Chats toggle controls nothing (review)", aClosedChatsToggleControlsNothing);
  it("an open Chats toggle controls the drawer", anOpenChatsToggleControlsTheDrawer);
});
