import { afterEach, describe, it, vi } from "vitest";

import {
  activeAlarmsHitsTheListPath,
  activeAlarmsSendsLimitEightByDefault,
  activeAlarmsSendsOneAssetIdsPerIdInOrder,
  activeAlarmsSendsStateActive,
  alarmSummaryHitsTheSummaryPath,
  alarmSummarySendsOneAssetIdsPerIdInOrder,
  activeAlarmsForAnOrganizationSendsItsId,
  activeAlarmsForAnOrganizationSendsNoAssetIds,
  activeAlarmsForAnOrganizationSendsStateActive,
  activeAlarmsForIdsSendsNoOrganizationId,
  alarmSummaryForAnOrganizationSendsItsId,
  alarmSummaryForAnOrganizationSendsNoAssetIds,
  alarmSummaryForIdsSendsNoOrganizationId,
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

describe("F3.66 alarms web client — the organization scope", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends organizationId on the active read for an organization", async () => {
    await activeAlarmsForAnOrganizationSendsItsId();
  });

  it("sends no assetIds on the active read for an organization", async () => {
    await activeAlarmsForAnOrganizationSendsNoAssetIds();
  });

  it("sends state=active on the active read for an organization", async () => {
    await activeAlarmsForAnOrganizationSendsStateActive();
  });

  it("sends no organizationId on the id-scoped active read", async () => {
    await activeAlarmsForIdsSendsNoOrganizationId();
  });

  it("sends organizationId on the summary read for an organization", async () => {
    await alarmSummaryForAnOrganizationSendsItsId();
  });

  it("sends no assetIds on the summary read for an organization", async () => {
    await alarmSummaryForAnOrganizationSendsNoAssetIds();
  });

  it("sends no organizationId on the id-scoped summary read", async () => {
    await alarmSummaryForIdsSendsNoOrganizationId();
  });
});
