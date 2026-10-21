import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { CopilotAwaitingFollowUpDto, CopilotConversationDetailDto, CopilotPendingChangeDto } from "@bms/shared";

import * as copilotApi from "../../api/copilot";
import * as confirmApi from "../../api/copilot-confirm";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { useCopilotStore } from "../../stores/copilot-store";
import { change } from "./confirm-card.spec";
import { CopilotDock } from "./copilot-dock";
import { CONVERSATION_ID, message, openPanel, send, settle, stub } from "./copilot-dock.spec";
import { FOLLOW_UP_WAIT_MS } from "./use-conversation-thread";

/**
 * `F4.244` — the dock resumes the follow-up wait from the thread: after a
 * route change (the Confirm seeded the cache), and after a reload or in a new
 * tab (the server's `awaitingFollowUp`, the stored session). A stored
 * conversation the server no longer has is dropped.
 *
 * Assertions live here; `copilot-dock-follow-up.test.tsx` is the Vitest entry
 * point (jsdom). Every read and write is a spy (an unstubbed fetch reaches
 * `:4000`, `F4.160`).
 */

const ADMIN = { id: "u1", email: "admin@bms.local", displayName: "admin", role: "admin" } as unknown as AuthUser;
const CHANGE_ID = "44444444-4444-4444-8444-444444444444";
const WAITING_APPLIED = "Applied. Waiting for the copilot…";
const WAITING_FAILED = "Not applied. Waiting for the copilot…";

function thread(over: Partial<CopilotConversationDetailDto> = {}): CopilotConversationDetailDto {
  return {
    id: CONVERSATION_ID,
    organizationId: null,
    title: null,
    createdAt: "2026-10-21T10:00:00.000Z",
    lastTurnAt: "2026-10-21T10:00:00.000Z",
    messages: [message("user", "publish Feeder", 1), message("assistant", "Confirm the card to publish it.", 2)],
    pendingChanges: [],
    awaitingFollowUp: null,
    ...over,
  };
}

function awaited(over: Partial<CopilotAwaitingFollowUpDto> = {}): CopilotAwaitingFollowUpDto {
  return { changeId: CHANGE_ID, status: "applied", ageMs: 1_000, ...over };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Renders the dock on `client`, so a remount reads the same Query cache (a route change). */
function renderDockWith(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CopilotDock user={ADMIN} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The stored session a reload or a new tab finds (`bms-copilot-session`). */
function storedSession(): void {
  useCopilotStore.setState({ userId: "u1", organizationId: "", conversationId: CONVERSATION_ID });
}

async function resumed(answer: CopilotConversationDetailDto) {
  const stubs = stub();
  const read = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(answer);
  storedSession();
  renderDockWith(newClient());
  await openPanel();
  return { ...stubs, read };
}

export async function resumesTheWaitFromAnAwaitedChangeOnMount(): Promise<void> {
  await resumed(thread({ awaitingFollowUp: awaited() }));
  expect(await screen.findByText(WAITING_APPLIED)).toBeTruthy();
  const button = screen.getByRole("button", { name: "Waiting…" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
}

export async function showsNotAppliedForAResumedFailedChange(): Promise<void> {
  await resumed(thread({ awaitingFollowUp: awaited({ status: "failed" }) }));
  expect(await screen.findByText(WAITING_FAILED)).toBeTruthy();
}

/** The resumed wait polls until the follow-up lands, then Send comes back and the reads stop. */
export async function pollsUntilTheResumedFollowUpLands(): Promise<void> {
  focusManager.setFocused(false);
  const { read } = await resumed(thread({ awaitingFollowUp: awaited() }));
  expect(await screen.findByText(WAITING_APPLIED)).toBeTruthy();
  read.mockResolvedValue(
    thread({
      messages: [
        ...thread().messages,
        message("action", 'Applied: Publish the dashboard template "Feeder".', 3),
        message("assistant", "Published.", 4),
      ],
    }),
  );
  expect(await screen.findByText("Published.", undefined, { timeout: 5_000 })).toBeTruthy();
  expect(await screen.findByRole("button", { name: "Send" })).toBeTruthy();
  const reads = read.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  expect(read.mock.calls.length).toBe(reads);
}

/** A follow-up the server says finished longer ago than the wait holds nothing, and nothing polls. */
export async function doesNotHoldSendForAWaitOlderThanTheWindow(): Promise<void> {
  focusManager.setFocused(false);
  const { read } = await resumed(thread({ awaitingFollowUp: awaited({ ageMs: FOLLOW_UP_WAIT_MS + 1_000 }) }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole("textbox", { name: "Message the copilot" }), { target: { value: "hi" } });
  expect(await screen.findByRole("button", { name: "Send" })).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  expect(read).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(WAITING_APPLIED)).toBeNull();
}

/** Proposes `pending` in a fresh conversation on `client` and clicks Confirm. */
async function confirmed(client: QueryClient, pending: CopilotPendingChangeDto) {
  const stubs = stub();
  stubs.turn.mockResolvedValueOnce({
    conversationId: CONVERSATION_ID,
    outcome: "answered",
    configured: true,
    reply: "Confirm the card to publish it.",
    messages: thread().messages,
    navigateTo: null,
    pendingChanges: [pending],
    fillStep: null,
  });
  const read = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(thread());
  const view = renderDockWith(client);
  await openPanel();
  await send("publish Feeder");
  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  return { view, read };
}

/**
 * Critique #1: a route change right after a Confirm, before the first poll,
 * remounts the dock on the same cache — it holds Send at once, with no read.
 * Mutation: `applied()` stops seeding `awaitingFollowUp`.
 */
export async function aRemountBeforeTheFirstPollKeepsTheWait(): Promise<void> {
  vi.spyOn(confirmApi, "confirmCopilotChange").mockResolvedValue({ id: "t" });
  const client = newClient();
  const { view, read } = await confirmed(client, change());
  expect(await screen.findByText(WAITING_APPLIED)).toBeTruthy();
  view.unmount();
  renderDockWith(client);
  // The panel remembers it was open (`bms-copilot-open`), so the remount shows it at once.
  await screen.findByRole("complementary", { name: "Copilot" });
  expect(await screen.findByText(WAITING_APPLIED)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Waiting…" })).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
}

/** The same after a route's own refusal: the follow-up still runs. Mutation: `routeFailed()` stops seeding. */
export async function aRouteFailureSeedsTheWaitToo(): Promise<void> {
  vi.spyOn(confirmApi, "confirmCopilotChange").mockRejectedValue(
    new ApiError(JSON.stringify({ message: "A template with no widgets cannot be published", statusCode: 400 }), 400),
  );
  const client = newClient();
  const { view, read } = await confirmed(client, change());
  expect(await screen.findByText(WAITING_FAILED)).toBeTruthy();
  view.unmount();
  renderDockWith(client);
  // The panel remembers it was open (`bms-copilot-open`), so the remount shows it at once.
  await screen.findByRole("complementary", { name: "Copilot" });
  expect(await screen.findByText(WAITING_FAILED)).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
}

/**
 * Review C4: a read that was in flight at the Confirm (here a focus read)
 * answers after the seed, from before the change was recorded. It must not
 * overwrite the seed. Mutation: drop the `cancelQueries` before the seed.
 */
export async function aReadInFlightAtTheConfirmDoesNotDropTheWait(): Promise<void> {
  vi.spyOn(confirmApi, "confirmCopilotChange").mockResolvedValue({ id: "t" });
  stub();
  const pending = change();
  const read = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValueOnce(thread({ pendingChanges: [pending] }));
  let answer: (detail: CopilotConversationDetailDto) => void = () => undefined;
  read.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
  read.mockResolvedValue(thread());
  storedSession();
  const client = newClient();
  const view = renderDockWith(client);
  await openPanel();
  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  focusManager.setFocused(false);
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText(WAITING_APPLIED)).toBeTruthy();
  await act(async () => {
    answer(thread({ pendingChanges: [pending] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  view.unmount();
  renderDockWith(client);
  // The panel remembers it was open (`bms-copilot-open`), so the remount shows it at once.
  await screen.findByRole("complementary", { name: "Copilot" });
  expect(await screen.findByText(WAITING_APPLIED)).toBeTruthy();
}

/** A stored conversation the server no longer has (404) is dropped; the next send makes a new one. Mutation: remove the 404 effect. */
export async function dropsAStoredConversationTheServerNoLongerHas(): Promise<void> {
  const stubs = stub();
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockRejectedValue(new ApiError('{"statusCode":404}', 404));
  storedSession();
  renderDockWith(newClient());
  await openPanel();
  await waitFor(() => expect(useCopilotStore.getState().conversationId).toBeNull());
  await send("hi");
  await waitFor(() => expect(stubs.create).toHaveBeenCalledTimes(1));
}

/** A server error is not a missing conversation: the stored id stays. Mutation: drop the 404 check. */
export async function keepsTheStoredConversationOnAServerError(): Promise<void> {
  stub();
  const read = vi.spyOn(copilotApi, "fetchCopilotConversation").mockRejectedValue(new ApiError('{"statusCode":500}', 500));
  storedSession();
  renderDockWith(newClient());
  await openPanel();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await settle();
  expect(useCopilotStore.getState().conversationId).toBe(CONVERSATION_ID);
}
