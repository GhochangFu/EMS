import { expect } from "vitest";

import {
  mqttPayloadFormatDefinitionSchema,
  type MqttConfig,
  type MqttDevice,
  type SourceSample,
} from "@bms/shared/ingest";

import type { AdapterContext } from "../adapter/types.js";
import { createMqttAdapter, MAX_PAYLOAD_BYTES } from "./mqtt.js";
import { makeFakeBroker } from "./mqtt.spec.js";

/**
 * `F4.334` / ADR 0116 decision 6 — the adapter decodes each message with the
 * format of the topic it arrived on. Golden sample: the BCPL meter message read
 * 2026-11-08. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const BCPL_TOPIC = "BCPL_LAK_PLANT_03_LAKWA/data";

const BCPL_FORMAT = {
  code: "thinkiot-register-array",
  definition: mqttPayloadFormatDefinitionSchema.parse({
    kind: "declarative",
    root: "array",
    deviceKey: ["TagName"],
    time: { path: ["Timestamp"], unit: "epoch_s" },
    readings: [
      { key: "treated_water_flow_klh", register: { path: ["Data"], index: 0, type: "float32" } },
      { key: "outlet_flow_totalizer_kl", register: { path: ["Data"], index: 3, type: "float32" } },
    ],
  }),
};

const record = (tag: string) => ({
  Data: [16294, 26214, 81, 18230, 9202, 113, 17852, -17809, 177, 82],
  Timestamp: "1794077986",
  TagName: tag,
});
const BCPL_SAMPLE = JSON.stringify([record("BCPL_LAKWA_02")]);
const AT = new Date("2026-11-07T18:59:46.000Z");
const BOTH_KEYS = ["treated_water_flow_klh", "outlet_flow_totalizer_kl"];

type Captured = { message: string; fields: Record<string, unknown> };
type Binding = AdapterContext<MqttConfig, MqttDevice>["bindings"][number];

function bcplBinding(tag: string, sourceKeys = BOTH_KEYS, topic = BCPL_TOPIC): Binding {
  return {
    rtuId: `id-${tag}`,
    rtuCode: tag,
    deviceKey: tag,
    device: { topic, payloadFormat: BCPL_FORMAT },
    sourceKeys,
  };
}

async function connected(bindings: readonly Binding[]) {
  const broker = makeFakeBroker();
  const adapter = createMqttAdapter(broker.transport);
  const warnings: Captured[] = [];
  const emitted: (readonly SourceSample[])[] = [];
  const connecting = adapter.connect({
    protocol: "mqtt",
    endpointKey: "broker:8883",
    config: { host: "broker", port: 8883, rejectUnauthorized: true, tls: true },
    credentials: {},
    bindings,
    logger: {
      info: () => undefined,
      warn: (message, fields) => warnings.push({ message, fields: fields ?? {} }),
      error: () => undefined,
    },
    signal: new AbortController().signal,
  });
  broker.fireConnect();
  await connecting;
  await adapter.subscribe((samples) => emitted.push(samples));
  return { broker, adapter, warnings, emitted };
}

/** A1 — the BCPL golden sample yields the two readings with the device time. */
export async function theBcplSampleEmitsTwoReadings(): Promise<void> {
  const { broker, adapter, emitted, warnings } = await connected([bcplBinding("BCPL_LAKWA_02")]);
  broker.fireMessage(BCPL_TOPIC, BCPL_SAMPLE);
  expect(emitted).toEqual([
    [
      { sourceKey: "treated_water_flow_klh", value: 1.2999999523162842, deviceKey: "BCPL_LAKWA_02", at: AT },
      { sourceKey: "outlet_flow_totalizer_kl", value: 46627.9453125, deviceKey: "BCPL_LAKWA_02", at: AT },
    ],
  ]);
  expect(warnings).toEqual([]);
  await adapter.disconnect();

  // sourceKeys scoping still applies.
  const scoped = await connected([bcplBinding("BCPL_LAKWA_02", ["treated_water_flow_klh"])]);
  scoped.broker.fireMessage(BCPL_TOPIC, BCPL_SAMPLE);
  expect(scoped.emitted.map((batch) => batch.map((s) => s.sourceKey))).toEqual([["treated_water_flow_klh"]]);
  await scoped.adapter.disconnect();
}

/** A2 — a format failure logs the code and a fixed reason, never the payload. */
export async function aFormatFailureLogsNoPayload(): Promise<void> {
  const { broker, adapter, emitted, warnings } = await connected([bcplBinding("BCPL_LAKWA_02")]);
  broker.fireMessage(BCPL_TOPIC, JSON.stringify(record("BCPL_LAKWA_02")));
  expect(emitted).toEqual([]);
  expect(warnings).toEqual([
    {
      message: "mqtt payload not decoded",
      fields: { topic: BCPL_TOPIC, formatCode: "thinkiot-register-array", reason: "root-mismatch" },
    },
  ]);
  const logged = JSON.stringify(warnings);
  expect(logged).not.toContain("Data");
  expect(logged).not.toContain("16294");
  await adapter.disconnect();
}

/** A3 — the F1.7 topic check holds for decoded records; two records route in order. */
export async function decodedRecordsKeepTheTopicCheck(): Promise<void> {
  const { broker, adapter, emitted, warnings } = await connected([
    bcplBinding("BCPL_LAKWA_01"),
    bcplBinding("BCPL_LAKWA_02"),
    bcplBinding("BCPL_OTHER_01", BOTH_KEYS, "other/topic"),
  ]);
  broker.fireMessage(BCPL_TOPIC, JSON.stringify([record("BCPL_LAKWA_01"), record("BCPL_LAKWA_02")]));
  expect(emitted.map((batch) => batch[0]?.deviceKey)).toEqual(["BCPL_LAKWA_01", "BCPL_LAKWA_02"]);

  // A device bound to another topic, claimed on this one, is refused as before.
  broker.fireMessage(BCPL_TOPIC, JSON.stringify([record("BCPL_OTHER_01")]));
  expect(emitted).toHaveLength(2);
  expect(warnings.map((w) => w.message)).toEqual(["mqtt payload rejected: device is not bound to this topic"]);
  await adapter.disconnect();
}

/** A4 — a topic with no format decodes as the PHE envelope, side by side with a BCPL topic. */
export async function anUnformattedTopicStillDecodesTheEnvelope(): Promise<void> {
  const phe: Binding = {
    rtuId: "id-RTU-1",
    rtuCode: "RTU-1",
    deviceKey: "RTU-1",
    device: { topic: "Airsprint-1051/Data/RTU-1" },
    sourceKeys: ["flow"],
  };
  const { broker, adapter, emitted, warnings } = await connected([phe, bcplBinding("BCPL_LAKWA_02")]);
  broker.fireMessage(
    "Airsprint-1051/Data/RTU-1",
    JSON.stringify({ dev_id: "RTU-1", values: { flow: 12.5 }, ts: 1_754_390_000_000 }),
  );
  expect(emitted).toEqual([[{ sourceKey: "flow", value: 12.5, deviceKey: "RTU-1", at: new Date(1_754_390_000_000) }]]);
  // The BCPL sample on the PHE topic is read as an envelope and routes nowhere, silently.
  broker.fireMessage("Airsprint-1051/Data/RTU-1", BCPL_SAMPLE);
  expect(emitted).toHaveLength(1);
  // Bad JSON on the built-in path keeps its old warning text.
  broker.fireMessage("Airsprint-1051/Data/RTU-1", "{");
  expect(warnings.map((w) => w.message)).toEqual(["mqtt payload was not valid JSON"]);
  await adapter.disconnect();
}

/** A5 — oversize is refused before any decode, on a formatted topic too. */
export async function oversizeIsRefusedBeforeDecoding(): Promise<void> {
  const { broker, adapter, emitted, warnings } = await connected([bcplBinding("BCPL_LAKWA_02")]);
  broker.fireMessage(BCPL_TOPIC, "[" + " ".repeat(MAX_PAYLOAD_BYTES) + "]");
  expect(emitted).toEqual([]);
  expect(warnings.map((w) => w.message)).toEqual(["mqtt payload rejected: too large"]);
  await adapter.disconnect();
}
