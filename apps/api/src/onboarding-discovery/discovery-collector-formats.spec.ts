import { expect } from "vitest";

import { mqttPayloadFormatDefinitionSchema } from "@bms/shared";

import { BUILTIN_DISCOVERY_FORMATS, createDiscoveryCollector, REDACTED, type DiscoveryFormat } from "./discovery-collector";

/**
 * `F4.334` / ADR 0116 decision 8 (plan T4.1) — the collector tries every
 * catalog format, records which one decoded each device, and counts each skip
 * by reason (`F4.335`). Golden sample: the BCPL meter message of 2026-11-08.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const BCPL: DiscoveryFormat = {
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
const FORMATS = [...BUILTIN_DISCOVERY_FORMATS, BCPL];

const record = (tag: string) => ({
  Data: [16294, 26214, 81, 18230, 9202, 113, 17852, -17809, 177, 82],
  Timestamp: "1794077986",
  TagName: tag,
});
const BCPL_SAMPLE = JSON.stringify([record("BCPL_LAKWA_02")]);

/** C1 — the BCPL sample decodes with the register-array format; the device carries the code. */
export function theBcplSampleDecodesWithItsFormat(): void {
  const c = createDiscoveryCollector({ formats: FORMATS });
  c.offer("BCPL_LAK_PLANT_03_LAKWA/data", BCPL_SAMPLE);
  const r = c.result();
  expect(r.devices).toEqual([
    {
      topic: "BCPL_LAK_PLANT_03_LAKWA/data",
      devId: "BCPL_LAKWA_02",
      messageCount: 1,
      payloadFormat: "thinkiot-register-array",
      keys: [
        { sourceKey: "treated_water_flow_klh", sampleValue: 1.2999999523162842 },
        { sourceKey: "outlet_flow_totalizer_kl", sampleValue: 46627.9453125 },
      ],
    },
  ]);
  expect(r.messages).toBe(1);
  expect(r.skipped).toBe(0);
  expect(r.skippedReasons).toEqual({});
}

/** C2 — a PHE envelope still decodes with the built-in, its keys unchanged. */
export function aPheEnvelopeDecodesWithTheBuiltin(): void {
  const c = createDiscoveryCollector({ formats: FORMATS });
  c.offer("Airsprint-1051/Data/1051", JSON.stringify({ dev_id: "1051", ts: 1, values: { flow: 2.5 }, rssi: -70 }));
  const [device] = c.result().devices;
  expect(device?.payloadFormat).toBe("thinkiot-envelope");
  expect(device?.keys).toEqual([
    { sourceKey: "rssi", sampleValue: -70 },
    { sourceKey: "flow", sampleValue: 2.5 },
  ]);
}

/** C3 — the skip reasons: no format, oversize, an unusable topic or device key (F4.335). */
export function eachSkipIsCountedByReason(): void {
  const c = createDiscoveryCollector({ formats: FORMATS, caps: { maxPayloadBytes: 1024 } });
  c.offer("t/1", "{}");
  c.offer("t/1", "not json");
  c.offer("t/1", BCPL_SAMPLE.padEnd(2048, " "));
  c.offer("", BCPL_SAMPLE);
  c.offer("t/1", JSON.stringify([record("password=hunter2")]));
  const r = c.result();
  expect(r.messages).toBe(0);
  expect(r.skipped).toBe(5);
  expect(r.skippedReasons).toEqual({ "no-format": 2, oversize: 1, "unusable-topic": 1, "unusable-device-key": 1 });
  // Without the BCPL format the same sample is no-format: the case BCPL hit before ADR 0116.
  const builtinOnly = createDiscoveryCollector({});
  for (let i = 0; i < 6; i += 1) builtinOnly.offer("BCPL/LAKWA", BCPL_SAMPLE);
  expect(builtinOnly.result()).toMatchObject({ messages: 0, skipped: 6, skippedReasons: { "no-format": 6 } });
}

/** C4 — the first format that decoded a device stays its format; the chosen format goes first. */
export function theFirstFormatStaysAndTheChosenGoesFirst(): void {
  // A declarative object format with no device key would decode a PHE envelope too.
  const anyObject: DiscoveryFormat = {
    code: "any-object",
    definition: mqttPayloadFormatDefinitionSchema.parse({
      kind: "declarative",
      root: "object",
      deviceKey: ["dev_id"],
      readings: [{ key: "flow", field: ["values", "flow"] }],
    }),
  };
  const envelope = JSON.stringify({ dev_id: "D1", values: { flow: 1 } });
  const chosenFirst = createDiscoveryCollector({ formats: [anyObject, ...FORMATS] });
  chosenFirst.offer("t/1", envelope);
  expect(chosenFirst.result().devices[0]?.payloadFormat).toBe("any-object");

  const builtinFirst = createDiscoveryCollector({ formats: [...FORMATS, anyObject] });
  builtinFirst.offer("t/1", envelope);
  builtinFirst.offer("t/1", envelope);
  const [device] = builtinFirst.result().devices;
  expect(device?.payloadFormat).toBe("thinkiot-envelope");
  expect(device?.messageCount).toBe(2);
}

/** C5 — one array-root message with two records is two devices and one message. */
export function anArrayRootYieldsTwoDevices(): void {
  const c = createDiscoveryCollector({ formats: FORMATS });
  c.offer("BCPL/LAKWA", JSON.stringify([record("BCPL_LAKWA_01"), record("BCPL_LAKWA_02")]));
  const r = c.result();
  expect(r.devices.map((d) => d.devId)).toEqual(["BCPL_LAKWA_01", "BCPL_LAKWA_02"]);
  expect(r.messages).toBe(1);
}

/** C6 — the H2 redaction holds on decoded values (a credential-looking string sample). */
export function decodedValuesAreRedactedAsBefore(): void {
  const c = createDiscoveryCollector({ formats: FORMATS, secrets: ["broker-secret-1"] });
  c.offer("t/1", JSON.stringify({ dev_id: "D1", values: { note: "broker-secret-1", flow: 1 } }));
  const keys = c.result().devices[0]?.keys ?? [];
  expect(keys.find((k) => k.sourceKey === "note")?.sampleValue).toBe(REDACTED);
}

// --- F4.343 / ADR 0119 decision 4 (ruling R6): binary formats ------------------

const WBLDC: DiscoveryFormat = {
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
const WITH_WBLDC = [...FORMATS, WBLDC];

/** The WBLDC frames captured 2026-11-09 (hex only, no login). */
const HEADER = "f2f01051" + "ea070b0009000f0024000000";
const GOAT = Uint8Array.from(Buffer.from(HEADER + "0f010301acff2a00" + "00".repeat(76), "hex"));
const VAP = Uint8Array.from(Buffer.from(HEADER + "69ff340001800280" + "00".repeat(76), "hex"));

const keysOf = (c: ReturnType<typeof createDiscoveryCollector>) =>
  Object.fromEntries((c.result().devices[0]?.keys ?? []).map((k) => [k.sourceKey, k.sampleValue]));

/** C7 — the GOAT frame decodes with the binary format; the topic is the device. */
export function theGoatFrameDecodesWithTheBinaryFormat(): void {
  const c = createDiscoveryCollector({ formats: WITH_WBLDC });
  c.offer("Haringhata_GOAT", GOAT);
  const r = c.result();
  expect(r.devices).toHaveLength(1);
  expect(r.devices[0]).toMatchObject({
    topic: "Haringhata_GOAT",
    devId: "Haringhata_GOAT",
    payloadFormat: "wbldc-temp-100",
    messageCount: 1,
  });
  const expected: Record<string, number> = { temp_ch0: 27.1, temp_ch1: 25.900000000000002, temp_ch2: -8.4, temp_ch3: 4.2 };
  for (let i = 4; i < 16; i += 1) expected[`temp_ch${i}`] = 0;
  expect(keysOf(c)).toEqual(expected);
  expect(r.messages).toBe(1);
  expect(r.skipped).toBe(0);
}

/** C8 — the VAP fault-code channels are absent from the drawer. */
export function theVapFaultChannelsAreAbsent(): void {
  const c = createDiscoveryCollector({ formats: WITH_WBLDC });
  c.offer("Haringhata_VAP", VAP);
  const keys = keysOf(c);
  expect(keys.temp_ch0).toBe(-15.100000000000001);
  expect(keys.temp_ch1).toBe(5.2);
  expect("temp_ch2" in keys).toBe(false);
  expect("temp_ch3" in keys).toBe(false);
  expect(Object.keys(keys)).toHaveLength(14);
}

/** C9 — a 100-byte JSON message is never read as a binary record, even with the binary format first. */
export function aJsonMessageOfTheSameLengthStaysJson(): void {
  const json = JSON.stringify({ dev_id: "D1", values: { k: 1 } }).padEnd(100, " ");
  expect(Buffer.byteLength(json)).toBe(100);
  const c = createDiscoveryCollector({ formats: [WBLDC, ...FORMATS] });
  c.offer("t/1", Buffer.from(json, "utf8"));
  expect(c.result().devices[0]).toMatchObject({ devId: "D1", payloadFormat: "thinkiot-envelope" });

  // With nothing but the binary format listed, a JSON message is no-format.
  const binaryOnly = createDiscoveryCollector({ formats: [WBLDC] });
  binaryOnly.offer("t/1", json);
  binaryOnly.offer("t/1", BCPL_SAMPLE);
  expect(binaryOnly.result()).toMatchObject({ messages: 0, skipped: 2, skippedReasons: { "no-format": 2 } });
}

/** C10 — a binary frame of another length is no-format; no new skip reason. */
export function aShortBinaryFrameIsNoFormat(): void {
  const c = createDiscoveryCollector({ formats: WITH_WBLDC });
  c.offer("Haringhata_GOAT", GOAT.subarray(0, 99));
  expect(c.result()).toMatchObject({ messages: 0, skipped: 1, skippedReasons: { "no-format": 1 } });
}
