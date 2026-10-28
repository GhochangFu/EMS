import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { CopilotConversationDto } from "@bms/shared";

import * as copilotApi from "../../api/copilot";
import { useCopilotStore } from "../../stores/copilot-store";
import { useCopilotWindowStore, type CopilotWindowMode } from "../../stores/copilot-window-store";
import { answered, CONVERSATION_ID, READY, renderDock, send, settle, stub } from "./copilot-dock.spec";
import { NOT_CONFIGURED_SENTENCE } from "./copilot-dock-parts";

/**
 * `F4.292` (ADR 0099 Amendment 9 E7) — the conversation list wired into the
 * dock: opening a listed chat, *New chat*, the list's invalidation, and where
 * the list shows in each window mode. Assertions live here;
 * `copilot-dock-chats.test.tsx` is the Vitest entry point (jsdom).
 * `copilot-dock.spec.tsx` gains no case. Every API read is a spy.
 */

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const LISTED_ID = "55555555-5555-4555-8555-555555555555";

const LISTED: CopilotConversationDto = {
  id: LISTED_ID,
  organizationId: ORG_ID,
  title: "PHE alarms",
  createdAt: "2026-10-27T10:00:00.000Z",
  lastTurnAt: "2026-10-27T10:05:00.000Z",
};

const SEARCH = { name: "Search chats" };
const CHATS_TOGGLE = { name: "Chats" };

/** The dock open in `mode`, the list answering {@link LISTED}, the listed chat's read answering. */
function openIn(mode: CopilotWindowMode) {
  const stubs = stub(READY);
  stubs.conversations.mockResolvedValue([LISTED]);
  const read = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue({
    ...LISTED,
    messages: [],
    pendingChanges: [],
    hasEarlier: false,
  });
  useCopilotWindowStore.setState({ open: true, mode });
  renderDock("admin");
  return { ...stubs, read };
}

async function openTheListedChat(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: /PHE alarms/ }));
}

/** Mutation: `openChat` stores nothing for a listed row. */
export async function openingAListedChatReadsIt(): Promise<void> {
  const { read } = openIn("maximized");
  await openTheListedChat();
  await waitFor(() => expect(read).toHaveBeenCalledWith(LISTED_ID, { limit: 50 }));
}

/** Mutation: `openConversation` keeps the old pick (the global administrator's select stays on all organizations). */
export async function openingAListedChatPicksItsOrganization(): Promise<void> {
  openIn("maximized");
  await screen.findByRole("option", { name: "PHE Water" });
  await openTheListedChat();
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Organization" })).toHaveValue(ORG_ID));
}

/** Mutation: `onNew` does nothing (the send goes on to the remembered conversation). */
export async function newChatThenASendMakesAConversation(): Promise<void> {
  useCopilotStore.setState({ userId: "u1", organizationId: "", conversationId: CONVERSATION_ID });
  const { create } = openIn("maximized");
  fireEvent.click(await screen.findByRole("button", { name: "New chat" }));
  await send("hi");
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
}

/** Mutation: drop the turn's `onSettled` invalidation. */
export async function aSentTurnReadsTheListAgain(): Promise<void> {
  const { conversations } = openIn("maximized");
  await screen.findByRole("button", { name: /PHE alarms/ });
  expect(conversations).toHaveBeenCalledTimes(1);
  await send("hi");
  await waitFor(() => expect(conversations).toHaveBeenCalledTimes(2));
}

/** Critic (low): a listed chat clears a turn's not-configured answer, as a pick does. Mutation: `openChat` keeps it. */
export async function openingAListedChatClearsANotConfiguredAnswer(): Promise<void> {
  const { turn } = openIn("maximized");
  turn.mockResolvedValue({ ...answered("hi", ""), outcome: "not_configured", configured: false, messages: [] });
  await send("hi");
  expect(await screen.findByText(NOT_CONFIGURED_SENTENCE)).toBeInTheDocument();
  await openTheListedChat();
  expect(await screen.findByRole("textbox", { name: "Message the copilot" })).toBeInTheDocument();
}

/** Mutation: the column only after the toggle (`column` false). */
export async function maximizedShowsTheListAsAColumn(): Promise<void> {
  openIn("maximized");
  expect(await screen.findByRole("searchbox", SEARCH)).toBeInTheDocument();
}

/** Mutation: show the toggle in every shape. */
export async function maximizedHasNoChatsToggle(): Promise<void> {
  openIn("maximized");
  await screen.findByRole("searchbox", SEARCH);
  expect(screen.queryByRole("button", CHATS_TOGGLE)).toBeNull();
}

/** Mutation: the drawer is open whatever the toggle says. */
export async function floatingHidesTheListUntilTheToggle(): Promise<void> {
  openIn("floating");
  await screen.findByRole("button", CHATS_TOGGLE);
  await settle();
  expect(screen.queryByRole("searchbox", SEARCH)).toBeNull();
}

/** Mutation: the toggle does nothing. */
export async function floatingShowsTheListAfterTheToggle(): Promise<void> {
  openIn("floating");
  fireEvent.click(await screen.findByRole("button", CHATS_TOGGLE));
  expect(await screen.findByRole("searchbox", SEARCH)).toBeInTheDocument();
}

/** Critic (medium): docked takes the drawer, not the column. Mutation: `column` for maximized or docked. */
export async function dockedHidesTheListUntilTheToggle(): Promise<void> {
  openIn("docked");
  await screen.findByRole("button", CHATS_TOGGLE);
  await settle();
  expect(screen.queryByRole("searchbox", SEARCH)).toBeNull();
}
