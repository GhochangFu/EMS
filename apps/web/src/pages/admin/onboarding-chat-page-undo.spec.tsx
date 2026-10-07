import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { OnboardingChatResponseDto, OnboardingSessionDto } from "@bms/shared";

import * as api from "../../api/admin/onboarding";
import { ApiError } from "../../lib/api-error";
import { renderPage, SESSION, SESSION_WITH_RTU, stubStart } from "./onboarding-chat-page.spec";

/**
 * `F3.25` (ADR 0094 decision 6, 9) — the Undo control, rendered.
 *
 * Assertions live here; `onboarding-chat-page-undo.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock (ADR 0042).
 * Every api call is stubbed: an unstubbed fetch reaches the real `:4000`.
 */

const HASH = "a".repeat(64);
const OLD_ID = "c0000000-0000-4000-8000-000000000001";
const NEW_ID = "c0000000-0000-4000-8000-000000000002";

const CHECKPOINTS: OnboardingSessionDto["checkpoints"] = [
  { id: OLD_ID, seq: 1, label: "Added RTU RTU-1", takenAt: new Date(0).toISOString() },
  { id: NEW_ID, seq: 2, label: "Added asset A1", takenAt: new Date(0).toISOString() },
];

const WITH_CHECKPOINTS: OnboardingSessionDto = { ...SESSION, checkpoints: CHECKPOINTS, draftHash: HASH };

function response(session: OnboardingSessionDto, suggestedReplies?: string[]): OnboardingChatResponseDto {
  return { assistantMessage: "ok", session, ...(suggestedReplies ? { suggestedReplies } : {}) };
}

async function waitForSession(): Promise<void> {
  await waitFor(() => expect(screen.getByRole("button", { name: "Upload Excel" })).toBeEnabled());
}

function undoButton(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-testid="undo-button"]');
}

/** U1 — no control without checkpoints; after a turn that records two, the control appears. */
export async function undoAppearsOnlyWithCheckpoints(): Promise<void> {
  stubStart();
  vi.spyOn(api, "sendOnboardingChat").mockResolvedValue(response(WITH_CHECKPOINTS));
  const container = renderPage();
  await waitForSession();
  expect(undoButton(container)).toBeNull();
  expect(container.querySelector('[data-testid="undo-select"]')).toBeNull();

  await userEvent.type(screen.getByPlaceholderText(/Type a message/), "hello");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(undoButton(container)).not.toBeNull());
  expect(container.querySelector('[data-testid="undo-select"]')).not.toBeNull();
}

/** U2 — Undo sends the newest id and the draft hash. */
export async function undoSendsTheCheckpointAndTheHash(): Promise<void> {
  stubStart(WITH_CHECKPOINTS);
  const rollback = vi.spyOn(api, "rollbackOnboardingSession").mockResolvedValue(response(SESSION));
  const container = renderPage();
  await waitFor(() => expect(undoButton(container)).not.toBeNull());
  await userEvent.click(undoButton(container)!);
  await waitFor(() => expect(rollback).toHaveBeenCalledTimes(1));
  expect(rollback).toHaveBeenCalledWith(SESSION.id, NEW_ID, HASH);
}

/** U2b — the older option sends its own id. */
export async function theOlderOptionSendsItsId(): Promise<void> {
  stubStart(WITH_CHECKPOINTS);
  const rollback = vi.spyOn(api, "rollbackOnboardingSession").mockResolvedValue(response(SESSION));
  const container = renderPage();
  await waitFor(() => expect(undoButton(container)).not.toBeNull());
  await userEvent.selectOptions(
    container.querySelector('[data-testid="undo-select"]') as HTMLSelectElement,
    OLD_ID,
  );
  await userEvent.click(undoButton(container)!);
  await waitFor(() => expect(rollback).toHaveBeenCalledTimes(1));
  expect(rollback).toHaveBeenCalledWith(SESSION.id, OLD_ID, HASH);
}

/** U3 — the `Undid:` action line renders as an action row and the drawer follows the response. */
export async function theUndidLineRendersAndTheDrawerFollows(): Promise<void> {
  stubStart({ ...SESSION_WITH_RTU, checkpoints: CHECKPOINTS, draftHash: HASH });
  vi.spyOn(api, "rollbackOnboardingSession").mockResolvedValue(
    response({
      ...SESSION,
      draft: { rtus: [] },
      checkpoints: [],
      messages: [
        {
          id: "m9",
          role: "action",
          content: "Undid: Added asset A1",
          createdAt: new Date(0).toISOString(),
        },
      ],
    }),
  );
  const container = renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /^Preview/ }));
  await screen.findByRole("button", { name: "Add credentials" });
  await userEvent.click(await screen.findByRole("button", { name: "Undo" }));

  const line = await screen.findByText("Undid: Added asset A1");
  expect(line).toHaveAttribute("data-message-role", "action");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Add credentials" })).toBeNull());
  expect(container.textContent).toContain("Add an RTU first");
}

/** U4 — a 409 says the draft changed and reloads the session once. */
export async function aConflictReloadsTheSession(): Promise<void> {
  stubStart(WITH_CHECKPOINTS);
  vi.spyOn(api, "rollbackOnboardingSession").mockRejectedValue(new ApiError("x", 409));
  const fetchSession = vi.spyOn(api, "fetchOnboardingSession").mockResolvedValue(SESSION);
  const container = renderPage();
  await waitFor(() => expect(undoButton(container)).not.toBeNull());
  await userEvent.click(undoButton(container)!);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "The draft changed elsewhere, so nothing was undone. The session was reloaded.",
  );
  await waitFor(() => expect(fetchSession).toHaveBeenCalledTimes(1));
  expect(fetchSession).toHaveBeenCalledWith(SESSION.id);
}

/** U4b — any other refusal shows its text and does not reload. */
export async function aBadRequestShowsItsTextWithoutARefetch(): Promise<void> {
  stubStart(WITH_CHECKPOINTS);
  vi.spyOn(api, "rollbackOnboardingSession").mockRejectedValue(
    new ApiError('{"message":"Unknown checkpoint","error":"Bad Request","statusCode":400}', 400),
  );
  const fetchSession = vi.spyOn(api, "fetchOnboardingSession").mockResolvedValue(SESSION);
  const container = renderPage();
  await waitFor(() => expect(undoButton(container)).not.toBeNull());
  await userEvent.click(undoButton(container)!);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Unknown checkpoint");
  expect(fetchSession).not.toHaveBeenCalled();
}

/** U5 — a server `undo` chip is never rendered; its sibling is (adjacent positive). */
export async function anUndoReplyIsNeverOffered(): Promise<void> {
  vi.spyOn(api, "createOnboardingSession").mockResolvedValue(response(SESSION, ["undo", "confirm rtu"]));
  renderPage();
  const group = await screen.findByRole("group", { name: "Suggested replies" });
  expect(within(group).getByRole("button", { name: "confirm rtu" })).toBeInTheDocument();
  expect(within(group).queryByRole("button", { name: "undo" })).toBeNull();
}

/** U6 — without a draft hash there is nothing to bind to, so the button is disabled. */
export async function undoIsDisabledWithoutAHash(): Promise<void> {
  stubStart({ ...WITH_CHECKPOINTS, draftHash: null });
  const container = renderPage();
  await waitFor(() => expect(undoButton(container)).not.toBeNull());
  expect(undoButton(container)).toBeDisabled();
}

/** A promise the case settles itself, so a mutation stays pending while it asserts. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** U7 — review finding: while a chat turn is in flight, Undo and its select are disabled. */
export async function undoIsDisabledWhileAChatTurnRuns(): Promise<void> {
  stubStart(WITH_CHECKPOINTS);
  const turn = deferred<OnboardingChatResponseDto>();
  vi.spyOn(api, "sendOnboardingChat").mockReturnValue(turn.promise);
  const rollback = vi.spyOn(api, "rollbackOnboardingSession").mockResolvedValue(response(SESSION));
  const container = renderPage();
  await waitFor(() => expect(undoButton(container)).toBeEnabled());
  await userEvent.type(screen.getByPlaceholderText(/Type a message/), "hello");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("button", { name: "Sending…" });
  expect(undoButton(container)).toBeDisabled();
  expect(container.querySelector('[data-testid="undo-select"]')).toBeDisabled();
  await userEvent.click(undoButton(container)!);
  expect(rollback).not.toHaveBeenCalled();
  turn.resolve(response(WITH_CHECKPOINTS));
  await waitFor(() => expect(undoButton(container)).toBeEnabled());
}

/**
 * U8 — review finding: while an undo is in flight, Send and the textarea are disabled and the
 * reply chips are withdrawn, as they are during a chat turn (F4.168: a chip's name cannot say
 * "pending", so it is hidden rather than disabled). The chips come back when the undo settles.
 */
export async function sendIsDisabledWhileAnUndoRuns(): Promise<void> {
  vi.spyOn(api, "createOnboardingSession").mockResolvedValue(response(WITH_CHECKPOINTS, ["confirm rtu"]));
  const undo = deferred<OnboardingChatResponseDto>();
  vi.spyOn(api, "rollbackOnboardingSession").mockReturnValue(undo.promise);
  const send = vi.spyOn(api, "sendOnboardingChat").mockResolvedValue(response(WITH_CHECKPOINTS));
  const container = renderPage();
  const group = await screen.findByRole("group", { name: "Suggested replies" });
  const chip = within(group).getByRole("button", { name: "confirm rtu" });
  await waitFor(() => expect(undoButton(container)).toBeEnabled());
  expect(chip).toBeEnabled();
  await userEvent.click(undoButton(container)!);
  await screen.findByRole("button", { name: "Undoing…" });
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(screen.getByPlaceholderText(/Type a message/)).toBeDisabled();
  expect(screen.queryByRole("group", { name: "Suggested replies" })).toBeNull();
  expect(send).not.toHaveBeenCalled();
  undo.resolve(response(WITH_CHECKPOINTS, ["confirm rtu"]));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
  const back = await screen.findByRole("group", { name: "Suggested replies" });
  expect(within(back).getByRole("button", { name: "confirm rtu" })).toBeEnabled();
}

/** U9 — review finding: a 409 whose reload fails says so, and does not claim the session was reloaded. */
export async function aConflictWhoseReloadFailsSaysSo(): Promise<void> {
  stubStart(WITH_CHECKPOINTS);
  vi.spyOn(api, "rollbackOnboardingSession").mockRejectedValue(new ApiError("x", 409));
  vi.spyOn(api, "fetchOnboardingSession").mockRejectedValue(new Error("network down"));
  const container = renderPage();
  await waitFor(() => expect(undoButton(container)).not.toBeNull());
  await userEvent.click(undoButton(container)!);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("network down"));
  expect(screen.getByRole("alert")).not.toHaveTextContent("The session was reloaded.");
}
