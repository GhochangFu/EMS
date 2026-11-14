import { screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

import { ApiError } from "../../lib/api-error";
import { CONVERSATION_ID, message, openPanel, READY, renderDock, send, stub } from "./copilot-dock.spec";

/**
 * `F4.360` defect 2 — a copilot turn that fails must not lose the user's own
 * message (AWS, 2026-11-14: a turn that hit the 45 s cap dropped it). A cap is
 * stored by the server with its cause, so the thread shows both; a failure
 * that stores nothing (a provider error, a failed request) puts the text back
 * in the composer. A credential refusal never does
 * (`bannersACredentialRefusalAndDoesNotRestoreTheInput`). Vitest entry point:
 * the sibling `.test.tsx`.
 */

const QUESTION = "Can you create a maintenance window on the cold rooms?";
const DEADLINE = "The assistant ran out of time before it could answer (the limit is 45 seconds).";

const box = (): HTMLElement => screen.getByRole("textbox", { name: "Message the copilot" });

/** The server stored the message and the cause: both are in the thread. */
export async function aCapTurnShowsTheMessageAndTheCause(): Promise<void> {
  const stubs = stub(READY);
  stubs.turn.mockResolvedValue({
    conversationId: CONVERSATION_ID,
    outcome: "failed",
    configured: true,
    reply: DEADLINE,
    messages: [message("user", QUESTION, 1), message("assistant", DEADLINE, 2)],
    navigateTo: null,
    pendingChanges: [],
    fillStep: null,
  });
  renderDock("admin");
  await openPanel();
  await send(QUESTION);
  const thread = screen.getByRole("log", { name: "Copilot conversation" });
  expect(await within(thread).findByText(QUESTION)).toBeInTheDocument();
  expect(within(thread).getByText(DEADLINE)).toBeInTheDocument();
  // Stored, so it is not also put back. Mutation: restore on every `failed` → red.
  expect(box()).toHaveValue("");
}

/** A failed turn that stored nothing puts the text back. Mutation: drop the restore → red. */
export async function aFailedTurnThatStoredNothingRestoresTheText(): Promise<void> {
  const stubs = stub(READY);
  stubs.turn.mockResolvedValue({
    conversationId: CONVERSATION_ID,
    outcome: "failed",
    configured: true,
    reply: "The assistant could not answer just now. Try again in a moment.",
    messages: [],
    navigateTo: null,
  });
  renderDock("admin");
  await openPanel();
  await send(QUESTION);
  expect(await screen.findByRole("alert")).toHaveTextContent("could not answer just now");
  await waitFor(() => expect(box()).toHaveValue(QUESTION));
}

/** A request that failed (a gateway timeout) puts the text back too. Mutation: restore on success only → red. */
export async function aFailedRequestRestoresTheText(): Promise<void> {
  const stubs = stub(READY);
  stubs.turn.mockRejectedValue(new ApiError("Gateway Timeout", 504));
  renderDock("admin");
  await openPanel();
  await send(QUESTION);
  await screen.findByRole("alert");
  await waitFor(() => expect(box()).toHaveValue(QUESTION));
}

/**
 * A 4xx other than the limit can refuse a message before the server's credential check read it (a missing
 * conversation, an invalid body): the text does not come back (ADR 0022). Mutation: restore on every error → red.
 */
export async function aRefusalBeforeTheCredentialCheckDoesNotRestore(): Promise<void> {
  const stubs = stub(READY);
  stubs.turn.mockRejectedValue(new ApiError("Conversation not found", 404));
  renderDock("admin");
  await openPanel();
  await send("mqtt://user:secret@host");
  await screen.findByRole("alert");
  expect(box()).toHaveValue("");
}
