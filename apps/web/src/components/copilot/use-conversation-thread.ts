import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type {
  CopilotConversationDetailDto,
  CopilotMessageDto,
  CopilotPendingChangeDto,
  CopilotSkillStateDto,
} from "@bms/shared";
import { isCopilotOutcomeLine } from "@bms/shared/copilot";

import { fetchCopilotConversation } from "../../api/copilot";
import { copilotConversationKey } from "../../stores/copilot-store";

/**
 * How often, and for how long, the dock reads the conversation after a
 * Confirm. The wait outlasts the follow-up turn's own 45-second deadline
 * (`TURN_DEADLINE_MS`, `apps/api/src/llm/agent-loop.ts`) with a margin.
 */
export const FOLLOW_UP_POLL_MS = 2_000;
export const FOLLOW_UP_WAIT_MS = 60_000;

/**
 * The thread as the Query cache holds it: the server's detail, and
 * `followUpSince` — the **local** time the awaited follow-up started, set once
 * when the answer arrives ({@link receivedThread}) or at the Confirm
 * ({@link awaitingAfterConfirm}). A local cache write (a turn, a Reject, a
 * skill state) spreads the entry, so it keeps that time; it never moves the
 * wait forward (review C2: a wait derived from `dataUpdatedAt` re-armed on
 * every such write).
 */
export type CachedThread = CopilotConversationDetailDto & { readonly followUpSince?: number };

/**
 * A server answer as the cache keeps it: the awaited follow-up's start is
 * `now - ageMs`, both local times, so the browser clock is never compared
 * with the database clock (owner ruling 2026-10-20).
 */
export function receivedThread(detail: CopilotConversationDetailDto, now: number = Date.now()): CachedThread {
  const awaited = detail.awaitingFollowUp ?? null;
  return awaited === null ? detail : { ...detail, followUpSince: now - awaited.ageMs };
}

/**
 * The thread after a Confirm, before any read: the confirmed change's card
 * goes, and the follow-up it starts is awaited from now. Written into the
 * cache, so a dock that remounts before the first poll (a route change)
 * holds Send at once, with no read.
 */
export function awaitingAfterConfirm(
  prev: CopilotConversationDetailDto,
  changeId: string,
  status: "applied" | "failed",
  now: number = Date.now(),
): CachedThread {
  return {
    ...prev,
    pendingChanges: prev.pendingChanges.filter((c) => c.id !== changeId),
    awaitingFollowUp: { changeId, status, ageMs: 0 },
    followUpSince: now,
  };
}

/** One wait: for which change, since when (local), and how many messages the thread held then. */
type Wait = { changeId: string; since: number; baseline: number; failed: boolean };

export type ConversationThread = {
  thread: UseQueryResult<CachedThread>;
  messages: CopilotMessageDto[];
  pendingChanges: CopilotPendingChangeDto[];
  skill: CopilotSkillStateDto | null;
  /** Set while Send is held and the thread polls for the follow-up's outcome line. */
  followUp: { failed: boolean } | null;
};

/**
 * `F4.244` — the dock's conversation thread and the wait for a confirmed
 * change's follow-up turn (ADR 0099 decision 4.7), out of `copilot-dock.tsx`.
 *
 * **Armed from the thread, on every mount.** The detail's `awaitingFollowUp`
 * names the change whose follow-up has not stored its outcome line; while it
 * is set and younger than {@link FOLLOW_UP_WAIT_MS}, the hook holds Send and
 * polls every {@link FOLLOW_UP_POLL_MS}. So the wait survives a route change
 * (the Confirm seeds the cache), a reload and a new tab (the server answers
 * it). An unreadable time fails closed: no hold on bad data.
 *
 * **Ended by that change's outcome.** An outcome line stored after the wait
 * began ends it once the latest answer no longer names the awaited change —
 * a line of an earlier change's follow-up does not (review C1). The wait also
 * ends at {@link FOLLOW_UP_WAIT_MS}, with one last read. That read cannot
 * re-arm it: the server's age is never smaller than the local one, because
 * the change finished before the Confirm's response reached the browser.
 *
 * **No disarm on a `null` answer alone.** With the age there is no long hold
 * from clock skew, the server never names a row the sweeper resolved, and a
 * `null` rule would race a read that was in flight at the Confirm (a
 * deliberate departure from the plan critique; the dock also cancels such a
 * read before it seeds the cache).
 *
 * **Fresh on focus.** The thread is fresh for the tab (`staleTime: Infinity`:
 * the dock writes every turn into it), so a second tab on the same
 * conversation re-reads it when the window gains focus and no wait is on
 * (review C3).
 */
export function useConversationThread(conversationId: string | null): ConversationThread {
  const queryClient = useQueryClient();
  const [wait, setWait] = useState<Wait | null>(null);
  const thread = useQuery<CachedThread>({
    queryKey: copilotConversationKey(conversationId),
    queryFn: async () => receivedThread(await fetchCopilotConversation(conversationId as string)),
    enabled: conversationId !== null,
    staleTime: Infinity,
    refetchInterval: wait === null ? false : FOLLOW_UP_POLL_MS,
    // A user who switches tab after a Confirm must still get the follow-up: the poll is bounded, so it may run hidden.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: wait === null ? "always" : false,
  });
  const messages = conversationId === null ? [] : (thread.data?.messages ?? []);
  const pendingChanges = conversationId === null ? [] : (thread.data?.pendingChanges ?? []);
  const skill = conversationId === null ? null : (thread.data?.skill ?? null);
  const awaited = conversationId === null ? null : (thread.data?.awaitingFollowUp ?? null);
  const since = conversationId === null ? undefined : thread.data?.followUpSince;

  // Arm: the thread names an awaited follow-up, still inside the wait. `!(… < …)` so NaN fails closed.
  useEffect(() => {
    if (wait !== null || awaited === null || since === undefined) return;
    if (!(Date.now() - since < FOLLOW_UP_WAIT_MS)) return;
    setWait({ changeId: awaited.changeId, since, baseline: messages.length, failed: awaited.status === "failed" });
  }, [awaited, since, wait, messages.length]);

  // A switched or dropped conversation keeps no hold. Only on a real change of id (review C7): a
  // plain effect on `[conversationId]` would also run on mount and cancel the arm above.
  const shownId = useRef(conversationId);
  useEffect(() => {
    if (shownId.current === conversationId) return;
    shownId.current = conversationId;
    setWait(null);
  }, [conversationId]);

  // The follow-up's outcome line arrived, or the wait ran out: stop polling. Not "the thread
  // grew": the follow-up stores its outcome and its reply in one write, and nothing else may write
  // meanwhile — Send waits too, so a user turn cannot race the follow-up's proposal.
  useEffect(() => {
    if (wait === null) return;
    const landed = messages.slice(wait.baseline).some((m) => m.role === "action" && isCopilotOutcomeLine(m.content));
    if (landed && awaited?.changeId !== wait.changeId) {
      setWait(null);
      return;
    }
    const left = FOLLOW_UP_WAIT_MS - (Date.now() - wait.since);
    const timer = setTimeout(() => {
      setWait(null);
      // One last read: a follow-up that finished just after the last poll still shows.
      if (conversationId !== null) void queryClient.invalidateQueries({ queryKey: copilotConversationKey(conversationId) });
    }, Math.max(0, left));
    return () => clearTimeout(timer);
  }, [wait, messages, awaited, conversationId, queryClient]);

  return { thread, messages, pendingChanges, skill, followUp: wait === null ? null : { failed: wait.failed } };
}
