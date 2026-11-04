// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aDoneOverrideRunSaysDone,
  aFailedOverrideRunShowsItsStoredError,
  aPointWithNoRunHasNoBackfillLine,
  aQueuedStandaloneRunSaysQueued,
  aRunningStandaloneRunShowsItsDaysAndRows,
  anActiveRunPollsTheListEveryFiveSeconds,
  noActiveRunLeavesThePollOff,
  thePollStopsOnceTheRunIsDone,
} from "./asset-points-page.backfill.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.311 PR 6b — the asset points page's backfill progress", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("a running standalone run shows its days and rows", async () => {
    await aRunningStandaloneRunShowsItsDaysAndRows();
  });

  it("a queued standalone run says queued", async () => {
    await aQueuedStandaloneRunSaysQueued();
  });

  it("a done override run says done", async () => {
    await aDoneOverrideRunSaysDone();
  });

  it("a failed override run shows its stored error", async () => {
    await aFailedOverrideRunShowsItsStoredError();
  });

  it("a point with no run has no backfill line", async () => {
    await aPointWithNoRunHasNoBackfillLine();
  });

  it("an active run polls the calc-points list every five seconds", async () => {
    await anActiveRunPollsTheListEveryFiveSeconds();
  });

  it("no active run leaves the poll off", async () => {
    await noActiveRunLeavesThePollOff();
  });

  it("the poll stops once the run is done", async () => {
    await thePollStopsOnceTheRunIsDone();
  });
});
