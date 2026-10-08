import { describe, it } from "vitest";

import {
  assertAChatTurnBuildsOnTheLockedRow,
  assertAChatTurnBuildsTheRingOnTheLockedRow,
  assertAChatTurnRacedByACommitIsAConflict,
  assertAChatTurnRacedByARollbackIsAConflict,
  assertAChatUndoRacedByAChatTurnIsAConflict,
  assertAChatWriteOverACommitIsAConflict,
  assertADraftAtTheDepthBoundStillWrites,
  assertAnOverDeepStoredDraftRefusesTheTurnByName,
  assertAnUndoOverAnOverDeepDraftRefusesByName,
  assertAnEmptyRingUndoBuildsOnTheLockedRow,
  assertAnEmptyRingUndoOverACommitIsAConflict,
  assertAnEmptyRingUndoRacedByACommitIsAConflict,
  assertAnEmptyRingUndoRacedByADraftChangeIsAConflict,
  assertACommittingConfirmBuildsItsMessagesOnTheLockedRow,
  assertACommittingConfirmWritesToTheCommittedRow,
  assertAConfirmWithNoProposalBuildsOnTheLockedRow,
  assertAConfirmWithNoProposalRacedByACommitIsAConflict,
  assertAConfirmWithNoProposalRacedByADraftChangeIsAConflict,
  assertAConfirmWriteOverACommitIsAConflict,
  assertARefusedCommitRacedByADraftChangeIsAConflict,
  assertAStaleConfirmKeepsAMessageWrittenInBetween,
  assertAStaleConfirmRacedByADraftChangeIsAConflict,
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

  it("builds the checkpoint ring on the locked row's ring", async () => {
    await assertAChatTurnBuildsTheRingOnTheLockedRow();
  });
});

describe("onboarding chat — the fail-closed null-hash guard (F4.230)", () => {
  it("answers 409 DRAFT_TOO_DEEP_FOR_TURN and writes nothing over a stored draft past the depth bound", async () => {
    await assertAnOverDeepStoredDraftRefusesTheTurnByName();
  });

  it("writes a turn over a draft exactly at the depth bound", async () => {
    await assertADraftAtTheDepthBoundStillWrites();
  });

  it("answers 409 DRAFT_TOO_DEEP_FOR_TURN and restores nothing on an undo over a draft past the depth bound", async () => {
    await assertAnUndoOverAnOverDeepDraftRefusesByName();
  });
});

describe("onboarding chat — the empty-ring undo under the row lock (F4.231)", () => {
  it("builds its two messages on the locked row's messages", async () => {
    await assertAnEmptyRingUndoBuildsOnTheLockedRow();
  });

  it("answers 409 DRAFT_CHANGED_DURING_TURN and writes nothing when the draft moved under the lock", async () => {
    await assertAnEmptyRingUndoRacedByADraftChangeIsAConflict();
  });

  it("answers 409 SESSION_NO_LONGER_DRAFT and writes nothing when a commit landed before the lock", async () => {
    await assertAnEmptyRingUndoRacedByACommitIsAConflict();
  });

  it("answers 409 when its write matches no draft row", async () => {
    await assertAnEmptyRingUndoOverACommitIsAConflict();
  });
});

describe("onboarding chat — the typed confirm under the row lock (F4.231)", () => {
  it("with no proposal builds its two messages on the locked row", async () => {
    await assertAConfirmWithNoProposalBuildsOnTheLockedRow();
  });

  it("with no proposal answers 409 DRAFT_CHANGED_DURING_TURN and writes nothing when the draft moved under the lock", async () => {
    await assertAConfirmWithNoProposalRacedByADraftChangeIsAConflict();
  });

  it("with no proposal answers 409 SESSION_NO_LONGER_DRAFT and writes nothing when a commit landed before the lock", async () => {
    await assertAConfirmWithNoProposalRacedByACommitIsAConflict();
  });

  it("with a stale proposal keeps a message written in between and clears the locked row's proposal without committing", async () => {
    await assertAStaleConfirmKeepsAMessageWrittenInBetween();
  });

  it("with a stale proposal answers 409 and writes nothing when the draft moved under the lock", async () => {
    await assertAStaleConfirmRacedByADraftChangeIsAConflict();
  });

  it("with a refused commit answers 409 and stores nothing when the draft moved under the lock", async () => {
    await assertARefusedCommitRacedByADraftChangeIsAConflict();
  });

  it("that commits builds its three messages on the locked row", async () => {
    await assertACommittingConfirmBuildsItsMessagesOnTheLockedRow();
  });

  it("that commits writes its messages to the row its own commit marked committed", async () => {
    await assertACommittingConfirmWritesToTheCommittedRow();
  });

  it("answers 409 when its write matches no draft row", async () => {
    await assertAConfirmWriteOverACommitIsAConflict();
  });
});
