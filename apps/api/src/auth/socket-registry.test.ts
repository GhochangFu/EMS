import { describe, it } from "vitest";

import {
  assertAlarmsDisabledReReadClosesTheSocket,
  assertAlarmsEnabledReReadKeepsTheSocket,
  assertAlarmsHandshakeWindowIsClosed,
  assertDisconnectsOnlyTheUsersSocketsAcrossNamespaces,
  assertListsEachConnectedUserOnce,
  assertListsNoIdForASocketWithoutOne,
  assertReturnsTheCount,
  assertTelemetryDisabledReReadClosesTheSocket,
  assertTelemetryEnabledReReadKeepsTheSocket,
  assertTelemetryHandshakeWindowIsClosed,
} from "./socket-registry.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("SocketRegistry (F3.78, ADR 0089 decision 8)", () => {
  it("disconnects only the user's sockets, across two namespaces", () => {
    assertDisconnectsOnlyTheUsersSocketsAcrossNamespaces();
  });

  it("returns the number of sockets it closed", () => {
    assertReturnsTheCount();
  });

  it("lists each connected user once, across namespaces", () => {
    assertListsEachConnectedUserOnce();
  });

  it("lists no id for a socket that carries none", () => {
    assertListsNoIdForASocketWithoutOne();
  });
});

describe("gateway handshake and a deactivated user (F3.78, ADR 0089 decision 8)", () => {
  it("/ws/alarms: a NOTIFY after verifyToken and before scope resolution still finds the socket", async () => {
    await assertAlarmsHandshakeWindowIsClosed();
  });

  it("/ws/telemetry: a NOTIFY after verifyToken and before scope resolution still finds the socket", async () => {
    await assertTelemetryHandshakeWindowIsClosed();
  });

  it("/ws/alarms: the disabled_at re-read after the scope closes a deactivated user's socket", async () => {
    await assertAlarmsDisabledReReadClosesTheSocket();
  });

  it("/ws/alarms: the re-read keeps an enabled user's socket open (positive control)", async () => {
    await assertAlarmsEnabledReReadKeepsTheSocket();
  });

  it("/ws/telemetry: the disabled_at re-read after the scope closes a deactivated user's socket", async () => {
    await assertTelemetryDisabledReReadClosesTheSocket();
  });

  it("/ws/telemetry: the re-read keeps an enabled user's socket open (positive control)", async () => {
    await assertTelemetryEnabledReReadKeepsTheSocket();
  });
});
