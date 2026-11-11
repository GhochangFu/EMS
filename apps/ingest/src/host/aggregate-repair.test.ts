import { describe, it } from "vitest";

import {
  aFailedMergedRefreshKeepsEveryMember,
  aMovedMemberOfAMergedRangeIsKept,
  overlappingWindowsShareOneRefresh,
  theMergeGapDecidesWhetherWindowsJoin,
  aFailedRefreshKeepsTheWindowAndLogsOnce,
  aFailingListIsOneLine,
  aSuccessfulRefreshClearsTheWindow,
  aWindowWidenedDuringTheRefreshSurvives,
  anInWindowWriteDuringTheRefreshKeepsTheWindow,
  atMostOnePassAMinutePerGateway,
  passesNeverOverlap,
  theClearComparesBothBoundsByGateway,
} from "./aggregate-repair.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — aggregate repair over dirty windows (ADR 0123 decision 11, plan T3.4)", () => {
  it("refreshes a window and then clears it", async () => {
    await aSuccessfulRefreshClearsTheWindow();
  });

  it("keeps the window and logs one line when the refresh throws", async () => {
    await aFailedRefreshKeepsTheWindowAndLogsOnce();
  });

  it("does not clear a window widened during the refresh", async () => {
    await aWindowWidenedDuringTheRefreshSurvives();
  });

  it("passes over a gateway at most once a minute", async () => {
    await atMostOnePassAMinutePerGateway();
  });

  it("never runs two passes at once", async () => {
    await passesNeverOverlap();
  });

  it("logs one line when the windows cannot be listed", async () => {
    await aFailingListIsOneLine();
  });

  it("clears by gateway id and both stored bounds", async () => {
    await theClearComparesBothBoundsByGateway();
  });

  it("keeps a window a late row landed inside during the refresh (code review 2)", async () => {
    await anInWindowWriteDuringTheRefreshKeepsTheWindow();
  });

  it("refreshes overlapping windows once, as one range (security review L3)", async () => {
    await overlappingWindowsShareOneRefresh();
  });

  it("joins windows at most an hour apart and keeps wider gaps apart", async () => {
    await theMergeGapDecidesWhetherWindowsJoin();
  });

  it("keeps every member of a failed merged range and spares the other ranges", async () => {
    await aFailedMergedRefreshKeepsEveryMember();
  });

  it("keeps a member that moved during a merged refresh and clears the rest", async () => {
    await aMovedMemberOfAMergedRangeIsKept();
  });
});
