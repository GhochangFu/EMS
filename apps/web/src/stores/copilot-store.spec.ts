import { expect } from "vitest";

import { clearCopilotSession, COPILOT_SESSION_KEY, useCopilotStore } from "./copilot-store";

/**
 * `F4.244` (owner ruling 2026-10-20) — the copilot session persists in
 * `localStorage`: the user, the pick and the conversation, and nothing else.
 * Assertions live here; `copilot-store.test.ts` is the Vitest entry point and
 * carries the jsdom docblock (`persist` writes to `localStorage`, ADR 0042
 * decision 2).
 */

const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const ORG = "22222222-2222-4222-8222-222222222222";

function stored(): { state: Record<string, unknown> } | null {
  const raw = window.localStorage.getItem(COPILOT_SESSION_KEY);
  return raw === null ? null : (JSON.parse(raw) as { state: Record<string, unknown> });
}

/** The stored state holds exactly the three session keys. Mutation: remove `persist`. */
export function theStoredKeysAreTheSessionOnly(): void {
  useCopilotStore.getState().setConversation("u1", CONVERSATION);
  expect(Object.keys(stored()?.state ?? {}).sort()).toEqual(["conversationId", "organizationId", "userId"]);
}

/** The one-shot onboarding request stays in memory. Mutation: remove `partialize`. */
export function theOnboardingRequestIsNotStored(): void {
  useCopilotStore.getState().requestOnboarding("u1", ORG);
  expect(useCopilotStore.getState().onboardRequest).not.toBeNull();
  expect(stored()?.state).not.toHaveProperty("onboardRequest");
}

/**
 * A reload reads back what the last tab wrote: the written value is kept, the
 * memory emptied (which writes too), the value put back, and the store
 * rehydrated. Mutation: `partialize` leaves `conversationId` out.
 */
export async function aReloadResumesTheStoredConversation(): Promise<void> {
  useCopilotStore.getState().pick("u1", ORG);
  useCopilotStore.getState().setConversation("u1", CONVERSATION);
  const written = window.localStorage.getItem(COPILOT_SESSION_KEY) ?? "";
  useCopilotStore.setState({ userId: null, organizationId: "", conversationId: null });
  expect(useCopilotStore.getState().conversationId).toBeNull();
  window.localStorage.setItem(COPILOT_SESSION_KEY, written);
  await useCopilotStore.persist.rehydrate();
  expect(useCopilotStore.getState().conversationId).toBe(CONVERSATION);
  expect(useCopilotStore.getState().userId).toBe("u1");
  expect(useCopilotStore.getState().organizationId).toBe(ORG);
}

/** The session exit empties the state and removes the key. Mutation: drop `persist.clearStorage()`. */
export function clearingRemovesTheStoredKey(): void {
  useCopilotStore.getState().setConversation("u1", CONVERSATION);
  expect(stored()).not.toBeNull();
  clearCopilotSession();
  expect(useCopilotStore.getState().conversationId).toBeNull();
  expect(window.localStorage.getItem(COPILOT_SESSION_KEY)).toBeNull();
}

/** `F4.292`: opening a listed chat sets the user, its pick and its id. Mutation: keep the old pick. */
export function openingAListedChatSetsItsPick(): void {
  useCopilotStore.getState().pick("u1", "");
  useCopilotStore.getState().openConversation("u1", ORG, CONVERSATION);
  const { userId, organizationId, conversationId } = useCopilotStore.getState();
  expect({ userId, organizationId, conversationId }).toEqual({ userId: "u1", organizationId: ORG, conversationId: CONVERSATION });
}
