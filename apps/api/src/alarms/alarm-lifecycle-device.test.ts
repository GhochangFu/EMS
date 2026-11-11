import { describe, it } from "vitest";

import {
  assertAClearedDeviceAlarmTellsItsSentChannels,
  assertADeviceAlarmEscalatesThroughTheProfile,
  assertAnRtuAlarmClearsAfter120SecondsOnline,
  assertAnRtuThatLeftMonitoringClearsAtOnce,
  assertAStaleHostKeepsRtuAlarmsOpen,
  assertStaleOrNotHeardSinceTheRaiseIsNotNormal,
  assertTheHostAlarmClearsAfter120SecondsFresh,
  assertTheRaiseRetrySkipsDeviceAlarms,
} from "./alarm-lifecycle-device.spec";

/** `F3.16` (plan B4) — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.16 — the lifecycle sweep over device alarms", () => {
  it("D1 clears an RTU alarm after 120 s Online, on the normal_since hold", async () => {
    await assertAnRtuAlarmClearsAfter120SecondsOnline();
  });
  it("D2 a Stale RTU, or one not heard since the raise, is not normal", async () => {
    await assertStaleOrNotHeardSinceTheRaiseIsNotNormal();
  });
  it("D3 a stale host keeps RTU alarms open", async () => {
    await assertAStaleHostKeepsRtuAlarmsOpen();
  });
  it("D4 an RTU no longer monitored or now edge-served clears at once", async () => {
    await assertAnRtuThatLeftMonitoringClearsAtOnce();
  });
  it("D5 the host alarm clears after 120 s fresh", async () => {
    await assertTheHostAlarmClearsAfter120SecondsFresh();
  });
  it("D6 escalates through the organization's profile with ruleId null; acknowledged or unmapped sends nothing", async () => {
    await assertADeviceAlarmEscalatesThroughTheProfile();
  });
  it("D7 the raise-retry phase skips device alarms", async () => {
    await assertTheRaiseRetrySkipsDeviceAlarms();
  });
  it("D8 a cleared device alarm tells only its sent channels", async () => {
    await assertAClearedDeviceAlarmTellsItsSentChannels();
  });
});
