import { describe, it } from "vitest";

import {
  assertADedupedRaiseIsNotCounted,
  assertAMissingHostRowRaisesTheHostAlarm,
  assertAnEdgeServedRtuRaisesNothing,
  assertANotMonitoredRtuRaisesNothing,
  assertAFailedHostRaiseLogsNoNames,
  assertAnOfflineRtuInsideTheRaiseDelayRaisesNothing,
  assertARestartAcrossTwoTicksRaisesNothing,
  assertARestartShorterThanTheHoldRaisesNothing,
  assertAnOfflineRtuRaisesOneCommsAlarm,
  assertAnRtuInsideItsWindowRaisesNothing,
  assertAStaleHostRaisesOneHostAlarmPerOrganizationAndNoRtuAlarm,
  assertThePruneRunsAndARaiseFailureDoesNotStopTheTick,
  assertTheDelayCountsFromAHostRestart,
  assertTheWindowStillGovernsWhenItIsLongerThanTheDelay,
} from "./device-health-sweep.service.spec";

/** `F3.16` (plan B3) — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.16 — the device-health sweep", () => {
  it("raises nothing for an Offline RTU silent less than the 5-minute raise delay (ADR 0127 Amendment 1)", async () => {
    await assertAnOfflineRtuInsideTheRaiseDelayRaisesNothing();
  });

  it("counts the raise delay from a host restart, not only from last-seen", async () => {
    await assertTheDelayCountsFromAHostRestart();
  });

  it("keeps the window in charge when it is longer than the raise delay", async () => {
    await assertTheWindowStillGovernsWhenItIsLongerThanTheDelay();
  });

  it("raises one rtu_comms warning for an Offline, monitored, cloud-served RTU", async () => {
    await assertAnOfflineRtuRaisesOneCommsAlarm();
  });
  it("raises nothing for an RTU that is Online or Stale", async () => {
    await assertAnRtuInsideItsWindowRaisesNothing();
  });
  it("raises nothing for an edge-served RTU (decision 18)", async () => {
    await assertAnEdgeServedRtuRaisesNothing();
  });
  it("raises nothing for a not-monitored RTU (decision 20)", async () => {
    await assertANotMonitoredRtuRaisesNothing();
  });
  it("raises one ingest_host alarm per organization and no RTU alarm while the host is stale", async () => {
    await assertAStaleHostRaisesOneHostAlarmPerOrganizationAndNoRtuAlarm();
  });
  it("raises nothing for a host restart shorter than the 120 s hold (ADR 0127 Amendment 2)", async () => {
    await assertARestartShorterThanTheHoldRaisesNothing();
  });
  it("raises nothing across a restart that comes back on the next tick", async () => {
    await assertARestartAcrossTwoTicksRaisesNothing();
  });
  it("logs no site or RTU name when a host raise fails (§9.6)", async () => {
    await assertAFailedHostRaiseLogsNoNames();
  });
  it("raises the host alarm when the serving host has no row", async () => {
    await assertAMissingHostRowRaisesTheHostAlarm();
  });
  it("prunes once per tick and survives one organization's failed raise", async () => {
    await assertThePruneRunsAndARaiseFailureDoesNotStopTheTick();
  });
  it("does not count a raise the dedupe refused", async () => {
    await assertADedupedRaiseIsNotCounted();
  });
});
