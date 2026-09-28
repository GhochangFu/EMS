// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  aFailedReadShowsTheErrorLine,
  aFailedRefetchKeepsTheLastDrawing,
  aWidgetMissingFromTheResponseDrawsUnassigned,
  cleanupLive,
  foreignReadingChangesNothing,
  refetchesEveryThirtySeconds,
  socketReadingReplacesTheValue,
  socketReadingTurnsAStaleNodeLive,
  twoMimicsOnACanvasShareOneRead,
} from "./mimic-widget-live.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.32 U4 — MimicWidgetLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupLive();
    vi.restoreAllMocks();
  });

  it("LV1 two mimics on a canvas share one read, for the dashboard's id", async () => {
    await twoMimicsOnACanvasShareOneRead();
  });
  it("LV2 a socket reading replaces the seeded value", async () => {
    await socketReadingReplacesTheValue();
  });
  it("LV3 a reading for a foreign asset changes nothing", async () => {
    await foreignReadingChangesNothing();
  });
  it("LV4 a socket reading turns a stale node live", async () => {
    await socketReadingTurnsAStaleNodeLive();
  });
  it("LV5 a widget missing from the response draws every node unassigned", async () => {
    await aWidgetMissingFromTheResponseDrawsUnassigned();
  });
  it("LV6 a failed read shows the error line and no node", async () => {
    await aFailedReadShowsTheErrorLine();
  });
  it("LV7 the read refetches every 30 s", async () => {
    await refetchesEveryThirtySeconds();
  });
  it("LV8 a failed refetch keeps the last good drawing", async () => {
    await aFailedRefetchKeepsTheLastDrawing();
  });
});
