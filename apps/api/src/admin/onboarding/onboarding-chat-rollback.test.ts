import { describe, it } from "vitest";

import {
  assertACommittedSessionIsForbidden,
  assertAKeptCredentialStaysSet,
  assertALostCredentialIsNamed,
  assertARollbackRestoresAndCutsTheRing,
  assertAStaleHashIsAConflict,
  assertAnUnknownCheckpointIsNotFound,
  assertTheResponseCarriesTheCutRing,
  assertUndoNeverCallsTheProvider,
  assertUndoRestoresTheNewestCheckpoint,
  assertUndoWithAFullStopIsAnOrdinaryTurn,
  assertUndoWithAnEmptyRingWritesNoDraft,
} from "./onboarding-chat-rollback.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("onboarding chat — the undo phrase (F3.25, ADR 0094 decision 6)", () => {
  it("never calls the provider", async () => {
    await assertUndoNeverCallsTheProvider();
  });

  it("restores the newest checkpoint and appends user, action and assistant", async () => {
    await assertUndoRestoresTheNewestCheckpoint();
  });

  it("with an empty ring writes the two messages and no draft", async () => {
    await assertUndoWithAnEmptyRingWritesNoDraft();
  });

  it("is exact: Undo. is an ordinary turn", async () => {
    await assertUndoWithAFullStopIsAnOrdinaryTurn();
  });
});

describe("POST sessions/:id/rollback — hash-bound (F3.25, ADR 0094 decisions 5, 6)", () => {
  it("answers 409 on a stale hash and writes nothing", async () => {
    await assertAStaleHashIsAConflict();
  });

  it("answers 404 on an unknown checkpoint and writes nothing", async () => {
    await assertAnUnknownCheckpointIsNotFound();
  });

  it("clears the proposal, re-derives the phase and cuts the ring (no redo)", async () => {
    await assertARollbackRestoresAndCutsTheRing();
  });

  it("refuses a committed session", async () => {
    await assertACommittedSessionIsForbidden();
  });

  it("names an RTU whose credential the restore lost", async () => {
    await assertALostCredentialIsNamed();
  });

  it("keeps credentialsSet on an RTU whose credential is still held", async () => {
    await assertAKeptCredentialStaysSet();
  });

  it("answers the cut ring on the response session", async () => {
    await assertTheResponseCarriesTheCutRing();
  });
});
