import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { CopilotConversationDto } from "@bms/shared";

import * as copilotApi from "../../api/copilot";
import { ConversationList, type ConversationListProps } from "./conversation-list";

/**
 * `F4.292` (ADR 0099 Amendment 9 E7) — the dock's conversation list.
 * `conversation-list.test.tsx` is the Vitest entry point (jsdom). The list
 * read is a spy (an unstubbed read reaches `:4000`).
 */

function chat(n: number, title: string | null): CopilotConversationDto {
  return {
    id: `c-${n}`,
    organizationId: null,
    title,
    createdAt: "2026-10-20T10:00:00.000Z",
    lastTurnAt: `2026-10-2${n}T10:00:00.000Z`,
  };
}

const CHATS = [chat(3, "PHE alarms"), chat(2, "KPI question"), chat(1, null)];

async function renderList(over: Partial<ConversationListProps> = {}) {
  vi.spyOn(copilotApi, "fetchCopilotConversations").mockResolvedValue(CHATS);
  const props = { currentId: null, onOpen: vi.fn(), onNew: vi.fn(), ...over };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConversationList {...props} />
    </QueryClientProvider>,
  );
  await screen.findByRole("list", { name: "Chats" });
  return props;
}

function titles(): string[] {
  return within(screen.getByRole("list", { name: "Chats" }))
    .getAllByRole("button")
    .map((b) => b.querySelector("span")?.textContent ?? "");
}

/** Mutation: sort the rows by title. */
export async function rowsKeepTheGivenOrder(): Promise<void> {
  await renderList();
  expect(titles().slice(0, 2)).toEqual(["PHE alarms", "KPI question"]);
}

/** Mutation: `===` for `includes` in the filter (a whole-title match only). */
export async function theSearchIsASubstringOfTheTitle(): Promise<void> {
  await renderList();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search chats" }), { target: { value: "alarm" } });
  expect(titles()).toEqual(["PHE alarms"]);
}

/** Mutation: compare without lowering the case. */
export async function theSearchIgnoresCase(): Promise<void> {
  await renderList();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search chats" }), { target: { value: "KPI" } });
  expect(titles()).toEqual(["KPI question"]);
}

/** Mutation: show an empty title for a `null` one. */
export async function aNullTitleShowsTheFallback(): Promise<void> {
  await renderList();
  const day = new Date("2026-10-21T10:00:00.000Z").toLocaleDateString(undefined, { dateStyle: "medium" });
  expect(titles()[2]).toBe(`Chat of ${day}`);
}

/** Mutation: New chat calls nothing. */
export async function newChatCallsOnNew(): Promise<void> {
  const props = await renderList();
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(props.onNew).toHaveBeenCalledTimes(1);
}

/** Mutation: a row click calls `onOpen` with the first row. */
export async function aRowClickOpensThatRow(): Promise<void> {
  const props = await renderList();
  fireEvent.click(screen.getByRole("button", { name: /KPI question/ }));
  expect(props.onOpen).toHaveBeenCalledWith(CHATS[1]);
}

/** Mutation: `aria-current` never set. */
export async function theOpenRowIsCurrent(): Promise<void> {
  await renderList({ currentId: "c-2" });
  expect(screen.getByRole("button", { name: /KPI question/ }).getAttribute("aria-current")).toBe("true");
}

/** Mutation: `aria-current` on every row. */
export async function anotherRowIsNotCurrent(): Promise<void> {
  await renderList({ currentId: "c-2" });
  expect(screen.getByRole("button", { name: /PHE alarms/ }).getAttribute("aria-current")).toBe("false");
}
