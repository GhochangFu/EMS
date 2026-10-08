import { describe, it } from "vitest";

import {
  assertSetCredentialsOverAMovedDraftAnswers409,
  assertSetCredentialsOverAnOverDeepDraftAnswers409ByName,
  assertSetCredentialsOverACommittedRowAnswers409,
  assertSetCredentialsOverAnUnchangedRowWritesTheSecret,
  assertSetCredentialsWhoseUpdateMatchesNothingAnswers409,
  assertTheUploadBuildsMessagesOnTheLockedRow,
  assertTheUploadOverAChangedDraftStillWrites,
  assertTheUploadOverACommittedRowAnswers409,
  assertTheUploadWhoseUpdateMatchesNothingAnswers409,
  assertThePatchOverACommittedRowAnswers409,
  assertThePatchWhoseUpdateMatchesNothingAnswers409,
  assertThePatchOverAChangedDraftStillWrites,
  assertThePatchInfersThePhaseOnTheLockedMerge,
  assertThePatchOverALoadedCommittedRowAnswers403,
} from "./onboarding-locked-writes.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("onboarding upload, credential and PATCH draft writes under the row lock (F4.233, F4.235, ADR 0094 decision 6)", () => {
  it("builds the upload's messages on the locked row", async () => {
    await assertTheUploadBuildsMessagesOnTheLockedRow();
  });

  it("answers 409 to an upload over a row committed under the lock", async () => {
    await assertTheUploadOverACommittedRowAnswers409();
  });

  it("answers 409 to an upload whose update matches no row", async () => {
    await assertTheUploadWhoseUpdateMatchesNothingAnswers409();
  });

  it("still writes an upload over a draft that changed (hash-unbound, F4.227)", async () => {
    await assertTheUploadOverAChangedDraftStillWrites();
  });

  it("answers 409 to a credential write over a row committed under the lock", async () => {
    await assertSetCredentialsOverACommittedRowAnswers409();
  });

  it("answers 409 to a credential write whose update matches no row", async () => {
    await assertSetCredentialsWhoseUpdateMatchesNothingAnswers409();
  });

  it("answers 409 DRAFT_CHANGED_DURING_TURN to a credential write over a moved draft", async () => {
    await assertSetCredentialsOverAMovedDraftAnswers409();
  });

  it("writes the secret and nothing else for a credential over an unchanged row", async () => {
    await assertSetCredentialsOverAnUnchangedRowWritesTheSecret();
  });

  it("answers 409 DRAFT_TOO_DEEP_FOR_TURN to a credential write over an over-deep draft", async () => {
    await assertSetCredentialsOverAnOverDeepDraftAnswers409ByName();
  });

  it("answers 409 to a PATCH over a row committed under the lock", async () => {
    await assertThePatchOverACommittedRowAnswers409();
  });

  it("answers 409 to a PATCH whose update matches no row", async () => {
    await assertThePatchWhoseUpdateMatchesNothingAnswers409();
  });

  it("still writes a PATCH over a draft that changed and merges on the locked row (F4.227, F4.235)", async () => {
    await assertThePatchOverAChangedDraftStillWrites();
  });

  it("infers a PATCH's phase on the merge over the locked draft (F4.235)", async () => {
    await assertThePatchInfersThePhaseOnTheLockedMerge();
  });

  it("answers 403 to a PATCH over a row already committed when loaded", async () => {
    await assertThePatchOverALoadedCommittedRowAnswers403();
  });
});
