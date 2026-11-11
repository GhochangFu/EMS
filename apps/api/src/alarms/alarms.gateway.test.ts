import { describe, it } from "vitest";

import {
  assertAnRtuAlarmReachesTheSocketsServedByThatRtu,
  assertAnUnknownHostAlarmOrganizationReachesOnlyUnscopedSockets,
  assertARuleAlarmIsScopedByItsAssetAsBefore,
  assertTheHandshakeCachesTheDeviceScope,
  assertTheHostAlarmReachesSocketsOnAMonitoredRtuOfItsOrganization,
  assertWithoutADeviceScopeAScopedSocketGetsNoDeviceAlarm,
} from "./alarms.gateway.spec";

/** `F3.16` (plan B5) — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.16 — AlarmsGateway.emitScoped and device alarms (ADR 0127 decision 14)", () => {
  it("an rtu_comms alarm reaches the sockets with an asset on that RTU, and the unscoped ones", async () => {
    await assertAnRtuAlarmReachesTheSocketsServedByThatRtu();
  });
  it("the host alarm reaches sockets with an asset on a monitored RTU of its organization", async () => {
    await assertTheHostAlarmReachesSocketsOnAMonitoredRtuOfItsOrganization();
  });
  it("a rule alarm is scoped by its asset as before", async () => {
    await assertARuleAlarmIsScopedByItsAssetAsBefore();
  });
  it("a scoped socket with no device scope receives no device alarm", async () => {
    await assertWithoutADeviceScopeAScopedSocketGetsNoDeviceAlarm();
  });
  it("a host alarm whose organization cannot be read reaches only unscoped sockets", async () => {
    await assertAnUnknownHostAlarmOrganizationReachesOnlyUnscopedSockets();
  });
  it("the handshake caches the socket's device scope; the global admin's is null", async () => {
    await assertTheHandshakeCachesTheDeviceScope();
  });
});
