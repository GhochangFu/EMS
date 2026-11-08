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
