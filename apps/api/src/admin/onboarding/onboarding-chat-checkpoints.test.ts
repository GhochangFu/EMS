import { describe, it } from "vitest";

import {
  assertAnOversizedSnapshotEndsTheHistory,
  assertAFullRingDropsTheOldest,
  assertAGarbageColumnReadsAsAnEmptyRing,
  assertAGuidedTurnRecordsThePreTurnDraft,
  assertAnAgentTurnRecordsOneCheckpoint,
  assertAnUnchangedTurnLeavesTheColumnAlone,
  assertPatchDraftClearsTheRing,
  assertSetCredentialsLeavesTheRing,
  assertTheCheckpointIsLabelledAndBoundToTheUserMessage,
  assertTheResponseCarriesSummariesAndTheHash,
  assertUploadExcelClearsTheRing,
} from "./onboarding-chat-checkpoints.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("onboarding chat — a checkpoint before each draft-changing turn (F3.25, ADR 0094 decision 4)", () => {
  it("records the pre-turn draft, its sections only", async () => {
    await assertAGuidedTurnRecordsThePreTurnDraft();
  });

  it("labels the checkpoint with the action line and binds it to the user message", async () => {
    await assertTheCheckpointIsLabelledAndBoundToTheUserMessage();
  });

  it("writes no checkpoints key on a turn that changes no section", async () => {
    await assertAnUnchangedTurnLeavesTheColumnAlone();
  });

  it("records one checkpoint on the agent path", async () => {
    await assertAnAgentTurnRecordsOneCheckpoint();
  });

  it("drops the oldest entry of a full ring", async () => {
    await assertAFullRingDropsTheOldest();
  });

  it("reads a garbage column as an empty ring", async () => {
    await assertAGarbageColumnReadsAsAnEmptyRing();
  });
});

describe("the session DTO carries summaries and the draft hash (F3.25, ADR 0094 decision 7)", () => {
  it("answers summaries only and the hash of the draft as written", async () => {
    await assertTheResponseCarriesSummariesAndTheHash();
  });
});

describe("ring hygiene on the other draft writes (F3.25, plan Q3)", () => {
  it("PATCH :id/draft clears the ring", async () => {
    await assertPatchDraftClearsTheRing();
  });

  it("the Excel upload clears the ring", async () => {
    await assertUploadExcelClearsTheRing();
  });

  it("setting a credential leaves the ring alone", async () => {
    await assertSetCredentialsLeavesTheRing();
  });
});

describe("onboarding chat — an oversized snapshot (F3.25 review finding)", () => {
  it("ends the undo history rather than skipping back past the step", async () => {
    await assertAnOversizedSnapshotEndsTheHistory();
  });
});
