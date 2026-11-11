import { describe, it } from "vitest";

import {
  assertADedupedRaiseIsNotCounted,
  assertAMissingHostRowRaisesTheHostAlarm,
  assertAnEdgeServedRtuRaisesNothing,
  assertANotMonitoredRtuRaisesNothing,
  assertAnOfflineRtuRaisesOneCommsAlarm,
  assertAnRtuInsideItsWindowRaisesNothing,
  assertAStaleHostRaisesOneHostAlarmPerOrganizationAndNoRtuAlarm,
  assertThePruneRunsAndARaiseFailureDoesNotStopTheTick,
} from "./device-health-sweep.service.spec";

/** `F3.16` (plan B3) — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.16 — the device-health sweep", () => {
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
