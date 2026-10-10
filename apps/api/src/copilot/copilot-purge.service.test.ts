import { beforeAll, describe, it } from "vitest";

import type { CopilotPurgeSummary } from "./copilot-purge.service";
import {
  assertAnOldApplyingClaimBecomesFailed,
  assertAnUnlistedUsersRowsSurvive,
  assertAPendingChangeOrphanedThisTickIsDeletedThisTick,
  assertAYoungApplyingClaimIsUntouched,
  assertNoListedUserMeansNoTransaction,
  assertOldOrphanPendingAndRejectedChangesAreDeleted,
  assertOneTransactionPerListedUserInOrder,
  assertTheAppliedChangeSurvivesWithANullConversation,
  assertTheOldConversationIsDeleted,
  assertTheOldConversationsMessagesCascaded,
  assertTheSecondListedUsersRowsArePurgedInTheirOwnTransaction,
  assertTheSummaryCountsWhatWasPurged,
  assertTheUserListIsReadOnTheFleetPoolOnly,
  assertTheYoungConversationSurvives,
  assertYoungOrFinishedOrphansSurvive,
  makeHarness,
  type PurgeHarness,
  runPurge,
} from "./copilot-purge.service.spec";

/**
 * `F3.85` PR 5 / ADR 0099 decision 8 — Vitest entry point for the copilot
 * history purge against fake pools. Assertions live in the sibling `.spec`
 * (ADR 0014).
 */
describe("F3.85 — CopilotPurgeService purges 30-day-old copilot history per user", () => {
  let h: PurgeHarness;
  let summary: CopilotPurgeSummary;

  beforeAll(async () => {
    h = makeHarness();
    summary = await runPurge(h);
  });

  it("deletes a conversation whose last turn is 31 days old", () => {
    assertTheOldConversationIsDeleted(h);
  });
  it("the deleted conversation's messages cascade", () => {
    assertTheOldConversationsMessagesCascaded(h);
  });
  it("the deleted conversation's applied change survives with conversation_id null", () => {
    assertTheAppliedChangeSurvivesWithANullConversation(h);
  });
  it("keeps a conversation whose last turn is 29 days old", () => {
    assertTheYoungConversationSurvives(h);
  });
  it("deletes orphan pending and rejected changes proposed 31 days ago", () => {
    assertOldOrphanPendingAndRejectedChangesAreDeleted(h);
  });
  it("deletes, in the same tick, an old pending change whose conversation the tick deleted", () => {
    assertAPendingChangeOrphanedThisTickIsDeletedThisTick(h);
  });
  it("keeps a 29-day orphan pending change and a 31-day failed one", () => {
    assertYoungOrFinishedOrphansSurvive(h);
  });
  it("fails an applying row claimed 31 days ago", () => {
    assertAnOldApplyingClaimBecomesFailed(h);
  });
  it("leaves an applying row claimed 29 days ago", () => {
    assertAYoungApplyingClaimIsUntouched(h);
  });
  it("opens one withUser transaction per listed user, naming that user", () => {
    assertOneTransactionPerListedUserInOrder(h);
  });
  it("purges the second listed user's rows in that user's own transaction", () => {
    assertTheSecondListedUsersRowsArePurgedInTheirOwnTransaction(h);
  });
  it("never reaches a user the fleet list did not name", () => {
    assertAnUnlistedUsersRowsSurvive(h);
  });
  it("lists users on the fleet pool and runs nothing on the tenant pool outside withUser", () => {
    assertTheUserListIsReadOnTheFleetPoolOnly(h);
  });
  it("returns counts of what it purged", () => {
    assertTheSummaryCountsWhatWasPurged(summary);
  });

  it("an empty user list opens no transaction", async () => {
    const empty = makeHarness([]);
    assertNoListedUserMeansNoTransaction(empty, await runPurge(empty));
  });
});
