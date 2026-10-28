import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { CopilotConversationDetailDto, CopilotMessageDto } from "@bms/shared";

import * as copilotApi from "../../api/copilot";
import { copilotConversationKey } from "../../stores/copilot-store";
import { detail } from "./use-conversation-thread.spec";
import { useThreadWindow } from "./use-thread-window";

/**
 * `F4.292` (ADR 0099 Amendment 9 E7) — `useThreadWindow`, the earlier pages
 * beside the thread. `use-thread-window.test.tsx` is the Vitest entry point
 * (jsdom). Every read is a spy (an unstubbed read reaches `:4000`).
 */

const ID = "11111111-1111-4111-8111-111111111111";

function row(n: number): CopilotMessageDto {
  return { id: `m-${n}`, conversationId: ID, role: "assistant", content: `Message ${n}.`, organizationIds: [], createdAt: "2026-10-28T10:00:00.000Z" };
}

function rows(...ns: number[]): CopilotMessageDto[] {
  return ns.map(row);
}

function ids(messages: readonly CopilotMessageDto[]): string[] {
  return messages.map((m) => m.id);
}

type Props = { newest: CopilotMessageDto[]; hasEarlier: boolean | undefined };

function mount(initial: Props, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ newest, hasEarlier }: Props) => useThreadWindow(ID, newest, hasEarlier), { wrapper, initialProps: initial });
  return { ...hook, client };
}

function page(messages: CopilotMessageDto[], hasEarlier: boolean): CopilotConversationDetailDto {
  return detail({ messages, hasEarlier });
}

/** Mutation: start from an empty window (`messages: known`). */
export function theWindowIsTheThreadAtFirst(): void {
  const { result } = mount({ newest: rows(3, 4), hasEarlier: true });
  expect(ids(result.current.messages)).toEqual(["m-3", "m-4"]);
}

/** Mutation: `hasEarlier: false` until a page answers. */
export function hasEarlierIsTheThreadsAtFirst(): void {
  const { result } = mount({ newest: rows(3, 4), hasEarlier: true });
  expect(result.current.hasEarlier).toBe(true);
}

/** Mutation: `before` = the newest known id (`messages[messages.length - 1]`). */
export async function loadEarlierReadsBeforeTheOldestRow(): Promise<void> {
  const read = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(page(rows(1, 2), false));
  const { result } = mount({ newest: rows(3, 4), hasEarlier: true });
  act(() => result.current.loadEarlier());
  await waitFor(() => expect(read).toHaveBeenCalledWith(ID, { before: "m-3", limit: 50 }));
}

/** Mutation: append the page after the window. */
export async function theAnswerGoesInFrontInOrder(): Promise<void> {
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(page(rows(1, 2), false));
  const { result } = mount({ newest: rows(3, 4), hasEarlier: true });
  act(() => result.current.loadEarlier());
  await waitFor(() => expect(ids(result.current.messages)).toEqual(["m-1", "m-2", "m-3", "m-4"]));
}

/** Mutation: keep the thread's `hasEarlier` after a page answered. */
export async function hasEarlierFollowsThePage(): Promise<void> {
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(page(rows(1, 2), false));
  const { result } = mount({ newest: rows(3, 4), hasEarlier: true });
  act(() => result.current.loadEarlier());
  await waitFor(() => expect(result.current.messages).toHaveLength(4));
  expect(result.current.hasEarlier).toBe(false);
}

/** Mutation: `setPrepended(0)` (or the page's length, counting a row the window held). */
export async function prependedCountsTheNewRows(): Promise<void> {
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(page(rows(1, 2, 3), true));
  const { result } = mount({ newest: rows(3, 4), hasEarlier: true });
  act(() => result.current.loadEarlier());
  await waitFor(() => expect(result.current.prepended).toBe(2));
}

/**
 * A focus read that answers only the last two rows keeps the earlier ones.
 * Mutation: render `newest` instead of the merged window.
 */
export async function aTruncatedThreadKeepsTheEarlierRows(): Promise<void> {
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(page(rows(1, 2), false));
  const { result, rerender } = mount({ newest: rows(3, 4, 5), hasEarlier: true });
  act(() => result.current.loadEarlier());
  await waitFor(() => expect(result.current.messages).toHaveLength(5));
  rerender({ newest: rows(4, 5), hasEarlier: true });
  expect(ids(result.current.messages)).toEqual(["m-1", "m-2", "m-3", "m-4", "m-5"]);
}

/** The dock's appended rows show once. Mutation: concatenate the stored window and `newest`. */
export async function anAppendedRowShowsOnce(): Promise<void> {
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(page(rows(1), false));
  const { result, rerender } = mount({ newest: rows(2, 3), hasEarlier: true });
  act(() => result.current.loadEarlier());
  await waitFor(() => expect(result.current.messages).toHaveLength(3));
  rerender({ newest: rows(2, 3, 4), hasEarlier: true });
  expect(ids(result.current.messages)).toEqual(["m-1", "m-2", "m-3", "m-4"]);
}

/**
 * Critic (medium): the thread's invalidation (a Confirm's `gone()`, the
 * wait's last read) never reaches the earlier rows. Mutation: the key under
 * the thread's prefix and a `queryFn` that reads the server again.
 */
export async function aThreadInvalidationKeepsTheEarlierRows(): Promise<void> {
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(page(rows(1, 2), false));
  const { result, client } = mount({ newest: rows(3, 4), hasEarlier: true });
  act(() => result.current.loadEarlier());
  await waitFor(() => expect(result.current.messages).toHaveLength(4));
  await act(async () => {
    await client.invalidateQueries({ queryKey: copilotConversationKey(ID) });
    // The cache notifies its observers on a timer: let a refetched answer reach the hook.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(ids(result.current.messages)).toEqual(["m-1", "m-2", "m-3", "m-4"]);
}

/** Mutation: `earlierFailed: false` always. */
export async function aRefusedPageSaysSo(): Promise<void> {
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockRejectedValue(new Error("down"));
  const { result } = mount({ newest: rows(3, 4), hasEarlier: true });
  act(() => result.current.loadEarlier());
  await waitFor(() => expect(result.current.earlierFailed).toBe(true));
}
