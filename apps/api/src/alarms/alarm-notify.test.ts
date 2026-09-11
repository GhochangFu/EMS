import { describe, it } from "vitest";

import {
  assertAClearedPayloadIsNeitherReadNorBroadcast,
  assertAMissingAlarmIsNotBroadcast,
  assertAMissingAlarmIsWarnedNamingTheId,
  assertAClearedRowIsNotBroadcastAsCreated,
  assertARejectedReadIsWarnedOnce,
  assertAValidCreatedPayloadIsReadOnceAndBroadcastOnce,
  assertAfterARejectedReadTheNextValidPayloadStillBroadcasts,
  assertAnUndecodablePayloadIsNotRead,
  assertAnUndecodablePayloadIsWarnedOnce,
  assertBuildAlarmListenerDepsBroadcastsThroughTheGateway,
  assertBuildAlarmListenerDepsWiresTheGauge,
  assertBuildAlarmListenerDepsWiresTheReconnectCounter,
  assertListensOnBmsAlarmsAfterConnect,
  assertNoLogLineCarriesTheUndecodablePayload,
  assertRegistersErrorBeforeConnect,
} from "./alarm-notify.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * One `it()` per row so a mutation reddens the row that owns the claim and
 * no other.
 */
describe("alarm-notify (F3.11, ADR 0064 decision 4)", () => {
  it("registers the error handler before connect()", async () => {
    await assertRegistersErrorBeforeConnect();
  });

  it("issues exactly LISTEN bms_alarms after connect", async () => {
    await assertListensOnBmsAlarmsAfterConnect();
  });

  it("reads a valid created payload once by id and broadcasts that row once (positive control)", async () => {
    await assertAValidCreatedPayloadIsReadOnceAndBroadcastOnce();
  });

  it("does not read for an undecodable payload", async () => {
    await assertAnUndecodablePayloadIsNotRead();
  });

  it("warns exactly once for an undecodable payload", async () => {
    await assertAnUndecodablePayloadIsWarnedOnce();
  });

  it("never writes the undecodable payload's text to a log line (SECRET-F311)", async () => {
    await assertNoLogLineCarriesTheUndecodablePayload();
  });

  it("warns once naming the id when the read returns null", async () => {
    await assertAMissingAlarmIsWarnedNamingTheId();
  });

  it("does not broadcast when the read returns null", async () => {
    await assertAMissingAlarmIsNotBroadcast();
  });

  it("does not broadcast a row whose clearedAt is set, and warns once naming the id (security L1)", async () => {
    await assertAClearedRowIsNotBroadcastAsCreated();
  });

  it("warns once with the real message when the read rejects", async () => {
    await assertARejectedReadIsWarnedOnce();
  });

  it("still broadcasts the next valid payload after a rejected read", async () => {
    await assertAfterARejectedReadTheNextValidPayloadStillBroadcasts();
  });

  it("neither reads nor broadcasts a cleared payload (F4.132's kind)", async () => {
    await assertAClearedPayloadIsNeitherReadNorBroadcast();
  });

  it("buildAlarmListenerDeps wires onStateChange to the connected gauge", () => {
    assertBuildAlarmListenerDepsWiresTheGauge();
  });

  it("buildAlarmListenerDeps wires onReconnectAttempt to the reconnect counter", () => {
    assertBuildAlarmListenerDepsWiresTheReconnectCounter();
  });

  it("buildAlarmListenerDeps broadcasts through AlarmsGateway.broadcastCreated", () => {
    assertBuildAlarmListenerDepsBroadcastsThroughTheGateway();
  });
});
