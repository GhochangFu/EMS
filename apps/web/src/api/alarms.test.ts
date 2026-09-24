import { afterEach, describe, it, vi } from "vitest";

import {
  activeAlarmsHitsTheListPath,
  activeAlarmsSendsLimitEightByDefault,
  activeAlarmsSendsOneAssetIdsPerIdInOrder,
  activeAlarmsSendsStateActive,
  alarmSummaryHitsTheSummaryPath,
  alarmSummarySendsOneAssetIdsPerIdInOrder,
} from "./alarms.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node`
 * default, not jsdom.
 */
describe("F3.28 alarms web client — what the rail's fetchers send", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends state=active on the active read", async () => {
    await activeAlarmsSendsStateActive();
  });

  it("sends one assetIds per id, in order, on the active read", async () => {
    await activeAlarmsSendsOneAssetIdsPerIdInOrder();
  });

  it("sends limit=8 by default on the active read", async () => {
    await activeAlarmsSendsLimitEightByDefault();
  });

  it("sends the active read to /api/v1/alarms", async () => {
    await activeAlarmsHitsTheListPath();
  });

  it("sends the summary read to /api/v1/alarms/summary", async () => {
    await alarmSummaryHitsTheSummaryPath();
  });

  it("sends one assetIds per id, in order, on the summary read", async () => {
    await alarmSummarySendsOneAssetIdsPerIdInOrder();
  });
});
