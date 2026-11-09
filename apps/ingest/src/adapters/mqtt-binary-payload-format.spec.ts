import { expect } from "vitest";

import { mqttPayloadFormatDefinitionSchema } from "@bms/shared/ingest";

import { MAX_PAYLOAD_BYTES } from "./mqtt.js";
import { type Binding, connected } from "./mqtt-payload-format.spec.js";

/**
 * `F4.343` / ADR 0119 decision 3 — the adapter passes the payload **bytes** to
 * the decoder, so a binary format reads the WBLDC frames. Golden samples: the
 * frames captured 2026-11-09 (hex only, no login). The BCPL gate stays in
 * `mqtt-payload-format.spec.ts`, unedited. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 */

const HEADER = "f2f01051" + "ea070b0009000f0024000000";
const GOAT = Buffer.from(HEADER + "0f010301acff2a00" + "00".repeat(76), "hex");
const VAP = Buffer.from(HEADER + "69ff340001800280" + "00".repeat(76), "hex");
const AT = new Date("2026-11-09T10:06:00.000Z");

const WBLDC_FORMAT = {
  code: "wbldc-temp-100",
  definition: mqttPayloadFormatDefinitionSchema.parse({
    kind: "binary",
    length: 100,
    byteOrder: "little",
    time: { fields: { year: 4, month: 6, day: 8, hour: 10, minute: 12, second: 14 }, utcOffsetMinutes: 330 },
    readings: Array.from({ length: 16 }, (_, i) => ({
      key: `temp_ch${i}`,
      byte: 16 + i * 2,
      type: "int16",
      scale: 0.1,
      sentinels: [-32767, -32766],
    })),
  }),
};

function wbldcBinding(topic: string, sourceKeys: string[]): Binding {
  // The topic is the device key (ADR 0119 R4).
  return { rtuId: `id-${topic}`, rtuCode: topic, deviceKey: topic, device: { topic, payloadFormat: WBLDC_FORMAT }, sourceKeys };
}

/** B1 — the GOAT frame emits the bound channels with the device time. */
export async function theGoatFrameEmitsItsReadings(): Promise<void> {
  const { broker, adapter, emitted, warnings } = await connected([
    wbldcBinding("Haringhata_GOAT", ["temp_ch0", "temp_ch2"]),
  ]);
  broker.fireMessage("Haringhata_GOAT", GOAT);
  expect(emitted).toEqual([
    [
      { sourceKey: "temp_ch0", value: 27.1, deviceKey: "Haringhata_GOAT", at: AT },
      { sourceKey: "temp_ch2", value: -8.4, deviceKey: "Haringhata_GOAT", at: AT },
    ],
  ]);
  expect(warnings).toEqual([]);
  await adapter.disconnect();
}

/** B1b — a frame inside a larger pooled `Buffer` decodes as its own 100 bytes. */
export async function aPooledFrameDecodes(): Promise<void> {
  const { broker, adapter, emitted } = await connected([wbldcBinding("Haringhata_GOAT", ["temp_ch0"])]);
  const pool = Buffer.alloc(140, 0x55);
  GOAT.copy(pool, 13);
  broker.fireMessage("Haringhata_GOAT", pool.subarray(13, 113));
  expect(emitted).toEqual([[{ sourceKey: "temp_ch0", value: 27.1, deviceKey: "Haringhata_GOAT", at: AT }]]);
  await adapter.disconnect();
}

/** B2 — a frame of another length logs the code and a fixed reason, never the bytes. */
export async function aShortFrameLogsNoBytes(): Promise<void> {
  const { broker, adapter, emitted, warnings } = await connected([wbldcBinding("Haringhata_GOAT", ["temp_ch0"])]);
  broker.fireMessage("Haringhata_GOAT", GOAT.subarray(0, 99));
  expect(emitted).toEqual([]);
  expect(warnings).toEqual([
    {
      message: "mqtt payload not decoded",
      fields: { topic: "Haringhata_GOAT", formatCode: "wbldc-temp-100", reason: "binary-length-mismatch" },
    },
  ]);
  const logged = JSON.stringify(warnings);
  expect(logged).not.toContain("f2f01051");
  expect(logged).not.toContain("0f01");
  await adapter.disconnect();
}

/** B3 — the VAP fault codes are absent: one sample, and the absent-readings line. */
export async function theVapFaultCodesAreReportedAbsent(): Promise<void> {
  const { broker, adapter, emitted, warnings } = await connected([
    wbldcBinding("Haringhata_VAP", ["temp_ch0", "temp_ch2", "temp_ch3"]),
  ]);
  broker.fireMessage("Haringhata_VAP", VAP);
  expect(emitted).toEqual([[{ sourceKey: "temp_ch0", value: -15.100000000000001, deviceKey: "Haringhata_VAP", at: AT }]]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]?.message).toBe("readings absent");
  expect(warnings[0]?.fields).toMatchObject({ missing: 2, firstMissing: "temp_ch2", empty: 0 });
  await adapter.disconnect();
}

/** B4 — a binary frame on a topic with no format is the old not-JSON line; nothing is emitted. */
export async function aBinaryFrameOnAnEnvelopeTopicIsNotJson(): Promise<void> {
  const phe: Binding = {
    rtuId: "id-RTU-1",
    rtuCode: "RTU-1",
    deviceKey: "RTU-1",
    device: { topic: "Airsprint-1051/Data/RTU-1" },
    sourceKeys: ["flow"],
  };
  const { broker, adapter, emitted, warnings } = await connected([phe]);
  broker.fireMessage("Airsprint-1051/Data/RTU-1", GOAT);
  expect(emitted).toEqual([]);
  expect(warnings).toEqual([{ message: "mqtt payload was not valid JSON", fields: { bytes: 100 } }]);
  await adapter.disconnect();
}

/** B5 — oversize is refused before any decode on a binary topic too. */
export async function oversizeIsRefusedFirst(): Promise<void> {
  const { broker, adapter, emitted, warnings } = await connected([wbldcBinding("Haringhata_GOAT", ["temp_ch0"])]);
  broker.fireMessage("Haringhata_GOAT", Buffer.alloc(MAX_PAYLOAD_BYTES + 1));
  expect(emitted).toEqual([]);
  expect(warnings.map((w) => w.message)).toEqual(["mqtt payload rejected: too large"]);
  await adapter.disconnect();
}
