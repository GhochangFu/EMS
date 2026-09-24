// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";

import {
  emptyAnswerSaysNoAssetClasses,
  emptyIdsFetchNothing,
  failedReadSaysUnavailableNotNone,
  fetchesForTheGivenIds,
  noWorstSeverityReadsAllGood,
  offlineAssetsAppendTheOfflineCount,
  pausedReadSaysLoadingNotNone,
  pendingReadSaysLoadingNotNone,
  socketEventRefetchesTheRoleSummary,
  worstSeverityItemReadsCountThenWorstCount,
} from "./asset-class-strip.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.28 asset class strip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
  });

  it('reads "MCCs 4 · 1 Critical" for a role at a worst severity', async () => {
    await worstSeverityItemReadsCountThenWorstCount();
  });

  it('reads "Transformer 2 · All Good" for a role with no active alarm', async () => {
    await noWorstSeverityReadsAllGood();
  });

  it('reads "MCCs 4 · 1 Critical · 2 Offline" with two assets offline', async () => {
    await offlineAssetsAppendTheOfflineCount();
  });

  it('reads "No asset classes in scope" for an empty answer', async () => {
    await emptyAnswerSaysNoAssetClasses();
  });

  it("says loading, not the empty text, while the read is pending", async () => {
    await pendingReadSaysLoadingNotNone();
  });

  it("says loading, not the empty text, while the read is paused offline", async () => {
    await pausedReadSaysLoadingNotNone();
  });

  it("says unavailable, not the empty text, when the read fails", async () => {
    await failedReadSaysUnavailableNotNone();
  });

  it("fetches the role summary for the given ids", async () => {
    await fetchesForTheGivenIds();
  });

  it("fetches nothing with no ids", async () => {
    await emptyIdsFetchNothing();
  });

  it("refetches the role summary on a /ws/alarms event", async () => {
    await socketEventRefetchesTheRoleSummary();
  });
});
