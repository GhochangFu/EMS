import { describe, it } from "vitest";

import {
  assertAChatTurnBuildsOnTheLockedRow,
  assertAChatTurnRacedByACommitIsAConflict,
  assertAChatTurnRacedByARollbackIsAConflict,
  assertAChatUndoRacedByAChatTurnIsAConflict,
  assertAChatWriteOverACommitIsAConflict,
  assertARollbackBuildsOnTheLockedRow,
  assertARollbackRacedByACommitIsForbidden,
  assertARollbackRacedByAChatTurnIsAConflict,
  assertACommittedSessionIsForbidden,
  assertAKeptCredentialStaysSet,
  assertARestoreToAnotherBrokerDropsTheCredential,
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

  it("drops a stored credential when the restored RTU points at another broker", async () => {
    await assertARestoreToAnotherBrokerDropsTheCredential();
  });

  it("answers the cut ring on the response session", async () => {
    await assertTheResponseCarriesTheCutRing();
  });
});

describe("rollback and chat writes — locked and status-bound (F3.25 review findings)", () => {
  it("answers 409 when a chat turn changed the draft between the read and the lock", async () => {
    await assertARollbackRacedByAChatTurnIsAConflict();
  });

  it("answers 403 when a commit landed between the read and the lock", async () => {
    await assertARollbackRacedByACommitIsForbidden();
  });

  it("re-checks the chat undo on the locked row too", async () => {
    await assertAChatUndoRacedByAChatTurnIsAConflict();
  });

  it("builds the write on the locked row", async () => {
    await assertARollbackBuildsOnTheLockedRow();
  });

  it("answers 409 when a chat write matches no draft row", async () => {
    await assertAChatWriteOverACommitIsAConflict();
  });
});

describe("onboarding chat — the hash-bound chat write (F4.227)", () => {
  it("answers 409 and writes nothing when a rollback changed the draft during the turn", async () => {
    await assertAChatTurnRacedByARollbackIsAConflict();
  });

  it("answers 409 and writes nothing when a commit landed before the lock", async () => {
    await assertAChatTurnRacedByACommitIsAConflict();
  });

  it("writes once, built on the locked row's messages, when the draft is unchanged", async () => {
    await assertAChatTurnBuildsOnTheLockedRow();
  });
});
