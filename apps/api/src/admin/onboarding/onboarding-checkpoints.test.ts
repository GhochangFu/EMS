import { describe, it } from "vitest";

import {
  assertCheckpointLabelIsBounded,
  assertCutRingBeforeKeepsLowerSeqs,
  assertIsUndoPhraseIsExact,
  assertPushCheckpointHoldsTheByteBound,
  assertPushCheckpointKeepsTheLastTen,
  assertReadCheckpointsFailsClosed,
  assertRestoreClearsTheCommitProposal,
  assertRestoreDoesNotMutateCurrent,
  assertRestoreReconcilesSecrets,
  assertSectionIsRestoredWholesale,
  assertTakeCheckpointCopiesTheSectionsOnly,
  assertTakeCheckpointOfAnEmptyDraftHasNoSections,
  assertUndoReplyNamesLostCredentials,
} from "./onboarding-checkpoints.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("onboarding checkpoints — the ring (F3.25, ADR 0094 decision 3)", () => {
  it("(1) takeCheckpoint copies the seven sections only, detached", () => {
    assertTakeCheckpointCopiesTheSectionsOnly();
  });

  it("(2) takeCheckpoint of an empty draft has empty sections", () => {
    assertTakeCheckpointOfAnEmptyDraftHasNoSections();
  });

  it("(3) readCheckpoints reads anything invalid as an empty ring", () => {
    assertReadCheckpointsFailsClosed();
  });

  it("(4) pushCheckpoint keeps the last ten", () => {
    assertPushCheckpointKeepsTheLastTen();
  });

  it("(5) pushCheckpoint holds the ring byte bound", () => {
    assertPushCheckpointHoldsTheByteBound();
  });
});

describe("onboarding checkpoints — the wholesale restore (F3.25, ADR 0094 decision 5)", () => {
  it("(6) location is restored wholesale", assertSectionIsRestoredWholesale("location"));
  it("(7) onboardingMeta is restored wholesale", assertSectionIsRestoredWholesale("onboardingMeta"));
  it("(8) rtus is restored wholesale", assertSectionIsRestoredWholesale("rtus"));
  it("(9) pointKeys is restored wholesale", assertSectionIsRestoredWholesale("pointKeys"));
  it("(10) assets is restored wholesale", assertSectionIsRestoredWholesale("assets"));
  it("(11) assetPoints is restored wholesale", assertSectionIsRestoredWholesale("assetPoints"));
  it("(12) templates is restored wholesale", assertSectionIsRestoredWholesale("templates"));

  it("(13) restoreSections reconciles the secrets and reports lost credentials", () => {
    assertRestoreReconcilesSecrets();
  });

  it("(14) restoreSections clears the commit proposal", () => {
    assertRestoreClearsTheCommitProposal();
  });

  it("(15) restoreSections does not mutate the current draft", () => {
    assertRestoreDoesNotMutateCurrent();
  });

  it("(16) cutRingBefore keeps only the lower seqs", () => {
    assertCutRingBeforeKeepsLowerSeqs();
  });
});

describe("onboarding checkpoints — the label and the undo phrase (F3.25, ADR 0094 decision 5)", () => {
  it("(17) checkpointLabel is bounded and falls back to the sections", () => {
    assertCheckpointLabelIsBounded();
  });

  it("(18) isUndoPhrase is exact", () => {
    assertIsUndoPhraseIsExact();
  });

  it("(19) undoReply names lost credentials only when there are some", () => {
    assertUndoReplyNamesLostCredentials();
  });
});
