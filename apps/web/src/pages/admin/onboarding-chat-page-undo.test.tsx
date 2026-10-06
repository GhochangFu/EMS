// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { restoreScrolling } from "./onboarding-chat-page.spec";
import {
  aConflictWhoseReloadFailsSaysSo,
  sendIsDisabledWhileAnUndoRuns,
  undoIsDisabledWhileAChatTurnRuns,
  aBadRequestShowsItsTextWithoutARefetch,
  aConflictReloadsTheSession,
  anUndoReplyIsNeverOffered,
  theOlderOptionSendsItsId,
  theUndidLineRendersAndTheDrawerFollows,
  undoAppearsOnlyWithCheckpoints,
  undoIsDisabledWithoutAHash,
  undoSendsTheCheckpointAndTheHash,
} from "./onboarding-chat-page-undo.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); the
 * jsdom docblock is on this file because Vitest reads it here (ADR 0042).
 * One `it()` per claim.
 */
describe("F3.25 onboarding chat page Undo control", () => {
  vi.setConfig({ testTimeout: 15_000 });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreScrolling();
  });

  it("shows no Undo control without checkpoints, and shows it after a turn records some", async () => {
    await undoAppearsOnlyWithCheckpoints();
  });

  it("sends the newest checkpoint id and the draft hash", async () => {
    await undoSendsTheCheckpointAndTheHash();
  });

  it("sends the older checkpoint's id when it is selected", async () => {
    await theOlderOptionSendsItsId();
  });

  it("renders the Undid line as an action row and follows the response session", async () => {
    await theUndidLineRendersAndTheDrawerFollows();
  });

  it("a 409 says the draft changed and reloads the session once", async () => {
    await aConflictReloadsTheSession();
  });

  it("a 400 shows its text and does not reload the session", async () => {
    await aBadRequestShowsItsTextWithoutARefetch();
  });

  it("never offers an undo reply chip", async () => {
    await anUndoReplyIsNeverOffered();
  });

  it("disables Undo when the draft hash is null", async () => {
    await undoIsDisabledWithoutAHash();
  });

  it("disables Undo and its select while a chat turn runs", async () => {
    await undoIsDisabledWhileAChatTurnRuns();
  });

  it("disables Send, the textarea and the reply chips while an undo runs", async () => {
    await sendIsDisabledWhileAnUndoRuns();
  });

  it("a 409 whose reload fails says so", async () => {
    await aConflictWhoseReloadFailsSaysSo();
  });
});
