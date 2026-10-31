import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { CopilotMessageDto } from "@bms/shared";
import { COPILOT_CONVERSATION_PAGE_DEFAULT } from "@bms/shared/contracts";

import { fetchCopilotConversation } from "../../api/copilot";
import { threadWindow, withEarlier } from "../../lib/copilot-thread-rows";
import { copilotConversationKey, copilotEarlierKey } from "../../stores/copilot-store";
import type { CachedThread } from "./use-conversation-thread";

/** The loaded window as the Query cache keeps it, and whether rows older than its first exist. */
export type ThreadWindowEntry = { readonly messages: readonly CopilotMessageDto[]; readonly hasEarlier: boolean };

export type ThreadWindow = {
  /** The rows to render: the earlier pages, then the thread's own rows, in the server's order. */
  messages: CopilotMessageDto[];
  /** Whether *Load earlier* has more to read. */
  hasEarlier: boolean;
  loadEarlier: () => void;
  loadingEarlier: boolean;
  /** The last *Load earlier* read failed (the button stays, for another try). */
  earlierFailed: boolean;
};

const NONE: readonly CopilotMessageDto[] = [];

function sameIds(a: readonly CopilotMessageDto[], b: readonly CopilotMessageDto[]): boolean {
  return a.length === b.length && a.every((m, i) => m.id === b[i]?.id);
}

/**
 * `F4.292` (ADR 0099 Amendment 9 E7) — the dock's window on a long thread:
 * the thread's newest page (`newest`, from `useConversationThread`) and the
 * earlier pages *Load earlier* reads in front of it.
 *
 * **Beside the thread, never in it.** The window lives in the Query cache
 * under {@link copilotEarlierKey} — it outlives the dock's unmount on a route
 * change, like the thread — and the earlier pages never enter
 * `thread.data.messages`, so the follow-up wait's ids and every cache write the
 * dock makes keep working on the thread alone. The key is not under the
 * thread's prefix: an invalidation or a cancel of the thread never reaches it.
 *
 * **Merged without a sort** ({@link threadWindow}): a newer read replaces the
 * window from its own first row on (a focus read's truncation keeps the
 * earlier rows; the dock's appended rows show once), and a newest page that
 * shares no row with the window replaces it (critic: a gap is never hidden).
 *
 * **`hasEarlier`** is the earliest read's: the last *Load earlier* answer's
 * while its rows lead the window, else the thread's own (`undefined` — an
 * unpaged read, the whole thread — is `false`).
 *
 * **A read belongs to its own chat** (review): the chat list stays open while a
 * page is read, so `loadingEarlier` and `earlierFailed` are the open chat's
 * only, and an answer goes in front of its own chat's rows — the window and
 * the thread cached under the read's id, never the rows rendered now.
 */
export function useThreadWindow(
  conversationId: string | null,
  newest: readonly CopilotMessageDto[],
  hasEarlierFromThread: boolean | undefined,
): ThreadWindow {
  const queryClient = useQueryClient();
  // Written by this hook only (`setQueryData`); `skipToken`: never read from a server, never refetched.
  const stored = useQuery<ThreadWindowEntry>({
    queryKey: copilotEarlierKey(conversationId),
    queryFn: skipToken,
    staleTime: Infinity,
  });
  const known = conversationId === null ? NONE : (stored.data?.messages ?? NONE);
  const messages = useMemo(() => threadWindow(known, newest), [known, newest]);
  const ledByEarlier = messages.length > 0 && messages[0]?.id !== newest[0]?.id;
  const hasEarlier = ledByEarlier ? (stored.data?.hasEarlier ?? false) : (hasEarlierFromThread ?? false);

  // Every change of the thread's rows is written into the window, so a later truncation keeps them.
  useEffect(() => {
    if (conversationId === null || newest.length === 0 || sameIds(known, messages)) return;
    queryClient.setQueryData<ThreadWindowEntry>(copilotEarlierKey(conversationId), { messages, hasEarlier });
  }, [conversationId, newest.length, known, messages, hasEarlier, queryClient]);

  const earlier = useMutation({
    mutationFn: ({ id, before }: { id: string; before: string }) =>
      fetchCopilotConversation(id, { before, limit: COPILOT_CONVERSATION_PAGE_DEFAULT }),
    onSuccess: (page, { id }) => {
      // Read at answer time, under the read's own id: the thread may have grown, or another chat may be open.
      const thread = queryClient.getQueryData<CachedThread>(copilotConversationKey(id))?.messages ?? NONE;
      const current = threadWindow(queryClient.getQueryData<ThreadWindowEntry>(copilotEarlierKey(id))?.messages ?? NONE, thread);
      queryClient.setQueryData<ThreadWindowEntry>(copilotEarlierKey(id), {
        messages: withEarlier(page.messages, current),
        hasEarlier: page.hasEarlier ?? false,
      });
    },
  });
  const ours = conversationId !== null && earlier.variables?.id === conversationId;
  const loadingEarlier = ours && earlier.isPending;

  function loadEarlier(): void {
    const oldest = messages[0];
    if (conversationId === null || oldest === undefined || loadingEarlier) return;
    earlier.mutate({ id: conversationId, before: oldest.id });
  }

  return {
    messages,
    hasEarlier,
    loadEarlier,
    loadingEarlier,
    earlierFailed: ours && earlier.isError,
  };
}
