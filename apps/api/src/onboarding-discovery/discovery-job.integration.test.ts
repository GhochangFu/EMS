import { afterAll, beforeAll, describe, it } from "vitest";

import { requireIntegrationMqtt } from "../testing/integration-mqtt-gate";
import {
  assertBothDevicesAndTheirKeys,
  assertTheBcplDeviceDecodesWithItsFormat,
  assertEachJobUsedItsOwnClientId,
  assertOneFinishRowPerJob,
  assertTheConcurrentSubscriberKeptReceiving,
  assertThePlainDiscoveryReturnsTheDevice,
  assertTheJobNeverPublished,
  assertTheWideDeviceIsTruncated,
  closeMqttSuite,
  openMqttSuite,
  runBcplWindow,
  runPlainWindow,
  runWindow,
  type MqttSuite,
  type PlainOutcome,
  type WindowOutcome,
} from "./discovery-job.integration.spec";

const mqttUrl = requireIntegrationMqtt({
  item: "F3.24b",
  label: "MQTT discovery integration tests",
  because:
    "these are the only proof that the discovery job groups a real broker's messages, truncates at a cap, " +
    "uses its own client id, never publishes, and leaves a concurrent subscriber receiving (ADR 0103).",
});

/** `F3.24b` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe.skipIf(!mqttUrl)("F3.24b — the discovery job against a real broker", () => {
  let suite: MqttSuite;
  let outcome: WindowOutcome;
  let plain: PlainOutcome;
  let bcpl: Awaited<ReturnType<typeof runBcplWindow>>;

  beforeAll(async () => {
    suite = openMqttSuite(mqttUrl as string);
    outcome = await runWindow(suite);
    plain = await runPlainWindow(suite);
    bcpl = await runBcplWindow(suite);
  }, 60_000);

  afterAll(async () => {
    await closeMqttSuite(suite);
  });

  it("stores both devices and their keys", () => assertBothDevicesAndTheirKeys(outcome, suite.prefix));
  it("truncates a device past 500 keys", () => assertTheWideDeviceIsTruncated(outcome));
  it("connects each job with its own client id", () => assertEachJobUsedItsOwnClientId(suite, outcome));
  it("never publishes", () => assertTheJobNeverPublished(outcome));
  it("leaves a concurrent subscriber receiving", () => assertTheConcurrentSubscriberKeptReceiving(outcome));
  it("writes one finish row per job", () => assertOneFinishRowPerJob(outcome));
  it("reaches a plain broker only through the allowlist rule (F4.326, ADR 0114)", () =>
    assertThePlainDiscoveryReturnsTheDevice(plain));
  it("decodes the BCPL sample with its payload format (F4.334, ADR 0116)", () => assertTheBcplDeviceDecodesWithItsFormat(bcpl));
});
