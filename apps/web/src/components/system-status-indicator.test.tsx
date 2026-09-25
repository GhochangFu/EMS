// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aDegradedFieldDataRendersItsLabel,
  aHungPollEndsInStatusUnavailable,
  aHungPollIsRetriedOnce,
  aFailedRefetchReplacesAStaleOperational,
  aNullPercentRendersADashAndNoBand,
  aRejectedReadHidesThePercentage,
  aRejectedReadRendersStatusUnavailableInRed,
  anOperationalBodyRendersTheOperationalVerdict,
  checkingStatusRendersWhileTheReadIsOpen,
  eightyFiveRendersFair,
  fiftyRendersPoor,
  ninetyEightPointSixRendersGood,
  theHookPollsEveryThirtySeconds,
  theTitleListsEveryComponent,
} from "./system-status-indicator.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.30 footer system status indicator", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("an operational body renders All systems operational", async () => {
    await anOperationalBodyRendersTheOperationalVerdict();
  });

  it("a degraded field_data renders Degraded: Field data", async () => {
    await aDegradedFieldDataRendersItsLabel();
  });

  it("98.6 % renders the Good band", async () => {
    await ninetyEightPointSixRendersGood();
  });

  it("85 % renders the Fair band", async () => {
    await eightyFiveRendersFair();
  });

  it("50 % renders the Poor band", async () => {
    await fiftyRendersPoor();
  });

  it("a null percent renders Data quality — and no band word", async () => {
    await aNullPercentRendersADashAndNoBand();
  });

  it("a rejected read renders Status unavailable in red", async () => {
    await aRejectedReadRendersStatusUnavailableInRed();
  });

  it("a rejected read hides the percentage", async () => {
    await aRejectedReadHidesThePercentage();
  });

  it("a failed refetch after a good read replaces the stale operational verdict", async () => {
    await aFailedRefetchReplacesAStaleOperational();
  });

  it("the title lists every component and its state", async () => {
    await theTitleListsEveryComponent();
  });

  it("renders Checking status… while the read is open", async () => {
    await checkingStatusRendersWhileTheReadIsOpen();
  });

  it("the hook polls: a second read at 30 s, not before", async () => {
    vi.useFakeTimers();
    await theHookPollsEveryThirtySeconds();
  });

  it("a poll the API never answers ends in Status unavailable after the timeout and one retry", async () => {
    vi.useFakeTimers();
    await aHungPollEndsInStatusUnavailable();
  });

  it("a poll the API never answers is retried exactly once", async () => {
    vi.useFakeTimers();
    await aHungPollIsRetriedOnce();
  });
});
