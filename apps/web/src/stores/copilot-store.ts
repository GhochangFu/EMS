import { create } from "zustand";

/**
 * `F3.85` PR 7 (review code:F2) — the copilot dock's session: which
 * conversation is open and, for the global administrator, which organization
 * it was started in.
 *
 * **Why a store and not `useState`.** `AppShell` is not a layout route: each
 * page renders its own, so every route change unmounts the dock — and
 * `open_page` exists to change the route. State held in the component reset
 * there, and the reply the user had just been given disappeared with the
 * conversation it belonged to. AGENTS.md §4.2 puts UI state in Zustand.
 *
 * **What is not here.** The messages live in the TanStack Query cache under
 * `copilotConversationKey(id)`, which outlives the unmount too. The open state
 * stays in `localStorage` (`bms-copilot-open`), read when the dock mounts.
 *
 * **Not persisted.** A page reload empties this store and the cache, so it
 * starts a new conversation. `fetchCopilotConversation` is the fallback for a
 * cache entry evicted while the dock was unmounted (over five minutes on the
 * onboarding route, where the dock hides).
 *
 * **Owned by one user.** `userId` records who started the session; the dock
 * reads the session only when it is the signed-in user's, so a second sign-in
 * in the same tab starts afresh instead of asking for another user's
 * conversation.
 */

/** The picker value for the global administrator's cross-organization scope. */
export const COPILOT_ALL_ORGANIZATIONS = "";

type CopilotSessionState = {
  userId: string | null;
  organizationId: string;
  conversationId: string | null;
  /** Picks the scope; a new scope starts a new conversation (the server reads it from the row). */
  pick: (userId: string, organizationId: string) => void;
  /** Records the conversation a turn was sent to, keeping the user's current pick. */
  setConversation: (userId: string, conversationId: string) => void;
};

const INITIAL = { userId: null, organizationId: COPILOT_ALL_ORGANIZATIONS, conversationId: null } as const;

export const useCopilotStore = create<CopilotSessionState>()((set, get) => ({
  ...INITIAL,
  pick: (userId, organizationId) => set({ userId, organizationId, conversationId: null }),
  setConversation: (userId, conversationId) => {
    const state = get();
    set({
      userId,
      organizationId: state.userId === userId ? state.organizationId : COPILOT_ALL_ORGANIZATIONS,
      conversationId,
    });
  },
}));

/** Back to no session — for a spec's `afterEach`, since the store is module-global. */
export function resetCopilotStore(): void {
  useCopilotStore.setState({ ...INITIAL });
}

/** The signed-in user's session; another user's reads as a fresh one. */
export function useCopilotSession(userId: string): { organizationId: string; conversationId: string | null } {
  const owner = useCopilotStore((s) => s.userId);
  const organizationId = useCopilotStore((s) => s.organizationId);
  const conversationId = useCopilotStore((s) => s.conversationId);
  return owner === userId
    ? { organizationId, conversationId }
    : { organizationId: COPILOT_ALL_ORGANIZATIONS, conversationId: null };
}

/** The TanStack Query key of one conversation's thread. */
export function copilotConversationKey(conversationId: string | null): readonly unknown[] {
  return ["copilot", "conversation", conversationId];
}
