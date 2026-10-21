import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { CopilotAwaitingFollowUpDto, CopilotConversationDetailDto, CopilotMessageDto } from "@bms/shared";

import * as copilotApi from "../../api/copilot";
import { ApiError } from "../../lib/api-error";
import { copilotConversationKey } from "../../stores/copilot-store";
import { awaitingAfterConfirm, type CachedThread, receivedThread, useConversationThread } from "./use-conversation-thread";

/**
 * `F4.244` — `useConversationThread`, the dock's thread and its follow-up
 * wait. `use-conversation-thread.test.tsx` is the Vitest entry point (jsdom).
 * Every read is a spy (an unstubbed read reaches `:4000`, `F4.160`). The
 * timed cases run on fake timers that also advance with real time, so
 * `waitFor` still polls.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "99999999-9999-4999-8999-999999999999";
const CHANGE = "44444444-4444-4444-8444-444444444444";
const T0 = Date.parse("2026-10-21T10:00:00.000Z");

export function detail(over: Partial<CopilotConversationDetailDto> = {}): CopilotConversationDetailDto {
  return {
    id: ID,
    organizationId: null,
    title: null,
    createdAt: "2026-10-21T09:00:00.000Z",
    lastTurnAt: "2026-10-21T09:00:00.000Z",
    messages: [],
    pendingChanges: [],
    ...over,
  };
}

function awaited(over: Partial<CopilotAwaitingFollowUpDto> = {}): CopilotAwaitingFollowUpDto {
  return { changeId: CHANGE, status: "applied", ageMs: 0, ...over };
}

function action(content: string, n: number): CopilotMessageDto {
  return { id: `m-${n}`, conversationId: ID, role: "action", content, organizationIds: [], createdAt: `2026-10-21T10:00:0${n}.000Z` };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function mount(client: QueryClient, id: string | null = ID) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(({ id: current }: { id: string | null }) => useConversationThread(current), { wrapper, initialProps: { id } });
}

function atT0(): void {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(T0);
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * The wait runs from the local start written with the answer, not from the
 * mount: an answer cached at T0 and mounted 30 s later ends at T0 + 60 s. The
 * final read answers `null`, so a correct hook cannot re-arm (critique F4).
 * Mutation: arm with `since: Date.now()`.
 */
export async function armsFromTheLocalStartNotFromTheMount(): Promise<void> {
  atT0();
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(detail({ awaitingFollowUp: null }));
  const client = newClient();
  client.setQueryData(copilotConversationKey(ID), receivedThread(detail({ awaitingFollowUp: awaited() })));
  await advance(30_000);
  const { result } = mount(client);
  await waitFor(() => expect(result.current.followUp).toEqual({ failed: false }));
  await advance(30_500);
  expect(result.current.followUp).toBeNull();
}

/**
 * An unreadable age holds nothing (fail closed means no hold on bad data):
 * no render ever has a wait, and no poll or final read follows the load
 * (critique F2). Mutation: the guard as `if (Date.now() - since >= WAIT) return`.
 */
export async function failsClosedOnAnUnreadableAge(): Promise<void> {
  const read = vi
    .spyOn(copilotApi, "fetchCopilotConversation")
    .mockResolvedValue(detail({ awaitingFollowUp: awaited({ ageMs: Number.NaN }) }));
  const seen: Array<{ failed: boolean } | null> = [];
  const client = newClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(
    () => {
      const thread = useConversationThread(ID);
      seen.push(thread.followUp);
      return thread;
    },
    { wrapper },
  );
  await waitFor(() => expect(Number.isNaN(result.current.thread.data?.awaitingFollowUp?.ageMs)).toBe(true));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(seen.length).toBeGreaterThan(1);
  expect(seen.filter((f) => f !== null)).toEqual([]);
  expect(read).toHaveBeenCalledTimes(1);
}

/**
 * Review C2: a local cache write after a wait timed out (its last read
 * failed, so the cache still names the change) does not hold Send again.
 * Mutation: derive the start from `dataUpdatedAt - ageMs`.
 */
export async function aLocalWriteAfterATimedOutWaitDoesNotReArm(): Promise<void> {
  atT0();
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockRejectedValue(new ApiError("down", 500));
  const client = newClient();
  client.setQueryData(copilotConversationKey(ID), awaitingAfterConfirm(detail(), CHANGE, "applied", T0));
  const { result } = mount(client);
  await waitFor(() => expect(result.current.followUp).not.toBeNull());
  await advance(61_000);
  expect(result.current.followUp).toBeNull();
  act(() => {
    client.setQueryData<CachedThread>(copilotConversationKey(ID), (prev) =>
      prev ? { ...prev, messages: [...prev.messages, { ...action("x", 1), role: "assistant", content: "A reply." }] } : prev,
    );
  });
  await advance(10);
  expect(result.current.messages.map((m) => m.content)).toEqual(["A reply."]);
  expect(result.current.followUp).toBeNull();
}

/** A switched conversation keeps no hold. Mutation: the reset effect does nothing. */
export async function resetsTheWaitWhenTheConversationChanges(): Promise<void> {
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(detail({ id: OTHER_ID }));
  const client = newClient();
  client.setQueryData(copilotConversationKey(ID), awaitingAfterConfirm(detail(), CHANGE, "applied"));
  client.setQueryData(copilotConversationKey(OTHER_ID), detail({ id: OTHER_ID }));
  const { result, rerender } = mount(client);
  await waitFor(() => expect(result.current.followUp).not.toBeNull());
  rerender({ id: OTHER_ID });
  expect(result.current.followUp).toBeNull();
}

/** A `Failed (HTTP 412): …` outcome line ends the wait (the shared predicate). Mutation: the `Applied: ` prefix only. */
export async function aFailedOutcomeLineEndsTheWait(): Promise<void> {
  atT0();
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(
    detail({ messages: [action("Failed (HTTP 412): Publish it. (Read it again.)", 1)], awaitingFollowUp: null }),
  );
  const client = newClient();
  client.setQueryData(copilotConversationKey(ID), awaitingAfterConfirm(detail(), CHANGE, "failed", T0));
  const { result } = mount(client);
  await waitFor(() => expect(result.current.followUp).toEqual({ failed: true }));
  await advance(2_100);
  expect(result.current.messages).toHaveLength(1);
  expect(result.current.followUp).toBeNull();
}

/**
 * Review C1, in the tab: the outcome line of an earlier change's follow-up
 * does not end the wait while the answer still names the awaited change —
 * not even for one render (the arm effect would re-arm it, but Send would be
 * released in between). Mutation: drop the `awaited?.changeId !== wait.changeId` check.
 */
export async function anotherChangesOutcomeLineDoesNotEndTheWait(): Promise<void> {
  atT0();
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(
    detail({ messages: [action("Applied: Archive Old.", 1)], awaitingFollowUp: awaited({ ageMs: 2_000 }) }),
  );
  const client = newClient();
  client.setQueryData(copilotConversationKey(ID), awaitingAfterConfirm(detail(), CHANGE, "applied", T0));
  const seen: Array<{ failed: boolean } | null> = [];
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(
    () => {
      const thread = useConversationThread(ID);
      seen.push(thread.followUp);
      return thread;
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.followUp).not.toBeNull());
  const armedAt = seen.findIndex((f) => f !== null);
  await advance(2_100);
  expect(result.current.messages).toHaveLength(1);
  expect(seen.slice(armedAt).filter((f) => f === null)).toEqual([]);
}

/**
 * An outcome line the thread held before the wait began does not end it,
 * even once an answer stops naming the change (critique F3: a hook-level case,
 * so a red is the assertion, not a hang). Mutation: `baseline: 0`.
 */
export async function anEarlierOutcomeLineDoesNotEndTheWait(): Promise<void> {
  atT0();
  const older = [action("Applied: An earlier change.", 1)];
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(detail({ messages: older, awaitingFollowUp: null }));
  const client = newClient();
  client.setQueryData(copilotConversationKey(ID), awaitingAfterConfirm(detail({ messages: older }), CHANGE, "applied", T0));
  const { result } = mount(client);
  await waitFor(() => expect(result.current.followUp).not.toBeNull());
  await advance(2_100);
  expect(result.current.thread.data?.awaitingFollowUp).toBeNull();
  expect(result.current.followUp).toEqual({ failed: false });
}

/**
 * Review C3: with no wait on, a window focus re-reads the thread (a second
 * tab on the same conversation sees the first tab's turns). Mutation:
 * `refetchOnWindowFocus: false`.
 */
export async function aFocusReReadsTheThreadWhenNoWaitIsOn(): Promise<void> {
  const read = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(detail());
  const { result } = mount(newClient());
  await waitFor(() => expect(result.current.thread.isSuccess).toBe(true));
  expect(read).toHaveBeenCalledTimes(1);
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
}
