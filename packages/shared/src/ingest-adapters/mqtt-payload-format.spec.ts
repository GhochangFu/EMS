import { expect } from "vitest";

import { parseMqttEnvelope } from "./mqtt-envelope";
import {
  MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION,
  type MqttPayloadFormatDefinition,
  decodeMqttPayload,
  mqttPayloadFormatDefinitionSchema,
} from "./mqtt-payload-format";
import { WBLDC_DEFINITION_INPUT, WBLDC_GOAT_HEX, bytesOf } from "./mqtt-payload-format-binary.spec";

/**
 * `F4.334` / ADR 0116 decision 3 — the payload format schema and the decoder.
 * Golden samples: the BCPL meter message read 2026-11-08 and the PHE envelope.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

/** The BCPL message, verbatim from the broker (ADR 0116 Context). */
export const BCPL_SAMPLE = JSON.stringify([
  {
    Data: [16294, 26214, 81, 18230, 9202, 113, 17852, -17809, 177, 82],
    Timestamp: "1794077986",
    TagName: "BCPL_LAKWA_02",
  },
]);

/** The `thinkiot-register-array` definition migration 0130 seeds (ADR 0116 decision 9). */
export const BCPL_DEFINITION_INPUT = {
  kind: "declarative",
  root: "array",
  deviceKey: ["TagName"],
  time: { path: ["Timestamp"], unit: "epoch_s" },
  wordOrder: "big",
  byteOrder: "big",
  readings: [
    { key: "treated_water_flow_klh", register: { path: ["Data"], index: 0, type: "float32" } },
    { key: "outlet_flow_totalizer_kl", register: { path: ["Data"], index: 3, type: "float32" } },
  ],
} as const;

const bcpl = (): MqttPayloadFormatDefinition =>
  mqttPayloadFormatDefinitionSchema.parse(BCPL_DEFINITION_INPUT);

const parses = (input: unknown): boolean => mqttPayloadFormatDefinitionSchema.safeParse(input).success;

/** The decoder takes bytes (ADR 0119 decision 2); the JSON fixtures stay text. */
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function records(definition: MqttPayloadFormatDefinition, raw: string, topic = "t/1") {
  const result = decodeMqttPayload(definition, topic, utf8(raw));
  if (!result.ok) {
    throw new Error(`expected a decode, got ${result.reason}`);
  }
  return result.records;
}

function withReadings(readings: unknown[], extra: Record<string, unknown> = {}): MqttPayloadFormatDefinition {
  return mqttPayloadFormatDefinitionSchema.parse({ ...BCPL_DEFINITION_INPUT, readings, ...extra });
}

// --- T1.1 schema -----------------------------------------------------------

export function theBcplAndBuiltinDefinitionsParse(): void {
  expect(parses(BCPL_DEFINITION_INPUT)).toBe(true);
  expect(parses({ kind: "builtin", name: "thinkiot-envelope" })).toBe(true);
  expect(parses({ kind: "builtin", name: "other" })).toBe(false);
}

export function theReadingsCapIs128(): void {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `k${i}`, field: ["v", i] }));
  expect(parses({ ...BCPL_DEFINITION_INPUT, readings: many(128) })).toBe(true);
  expect(parses({ ...BCPL_DEFINITION_INPUT, readings: many(129) })).toBe(false);
  expect(parses({ ...BCPL_DEFINITION_INPUT, readings: [] })).toBe(false);
}

export function pathsAreBoundedAndRefusePrototypeNames(): void {
  const field = (path: unknown) => ({ ...BCPL_DEFINITION_INPUT, readings: [{ key: "a", field: path }] });
  expect(parses(field(["a", "b", "c", "d", "e", "f", "g", "h"]))).toBe(true);
  expect(parses(field(["a", "b", "c", "d", "e", "f", "g", "h", "i"]))).toBe(false);
  expect(parses(field([]))).toBe(false);
  for (const name of ["__proto__", "constructor", "prototype"]) {
    expect(parses(field([name])), name).toBe(false);
  }
  expect(parses(field([-1]))).toBe(false);
  expect(parses({ ...BCPL_DEFINITION_INPUT, readings: [{ key: "__proto__", field: ["a"] }] })).toBe(false);
}

export function theReadingShapeIsStrict(): void {
  const register = { path: ["Data"], index: 0, type: "float32" };
  const one = (reading: unknown) => ({ ...BCPL_DEFINITION_INPUT, readings: [reading] });
  expect(parses(one({ key: "a", register: { ...register, type: "float16" } }))).toBe(false);
  expect(parses(one({ key: "a", field: ["x"], register }))).toBe(false);
  expect(parses(one({ key: "a", register, scale: 2, offset: -1 }))).toBe(true);
  expect(parses(one({ key: "a", field: ["x"], extra: 1 }))).toBe(false);
  expect(parses({ ...BCPL_DEFINITION_INPUT, script: "x" })).toBe(false);
  const duplicate = [
    { key: "a", field: ["x"] },
    { key: "a", field: ["y"] },
  ];
  expect(parses({ ...BCPL_DEFINITION_INPUT, readings: duplicate })).toBe(false);
}

export function wordAndByteOrderDefaultToBig(): void {
  const { wordOrder: _w, byteOrder: _b, ...rest } = BCPL_DEFINITION_INPUT;
  const parsed = mqttPayloadFormatDefinitionSchema.parse(rest);
  expect(parsed.kind === "declarative" && parsed.wordOrder).toBe("big");
  expect(parsed.kind === "declarative" && parsed.byteOrder).toBe("big");
}

// --- T1.2 decoder ------------------------------------------------------------

/** 1 — BCPL golden. */
export function theBcplGoldenSampleDecodes(): void {
  const decoded = records(bcpl(), BCPL_SAMPLE);
  expect(decoded).toHaveLength(1);
  const [record] = decoded;
  expect(record?.deviceKey).toBe("BCPL_LAKWA_02");
  expect(record?.at?.toISOString()).toBe("2026-11-07T18:59:46.000Z");
  expect(record?.values).toEqual({
    treated_water_flow_klh: 1.2999999523162842,
    outlet_flow_totalizer_kl: 46627.9453125,
  });
}

/** 2 — the word-order twin: dropping the swap reddens 1 and 2 together. */
export function theWordOrderTwinDecodesDifferently(): void {
  const little = mqttPayloadFormatDefinitionSchema.parse({ ...BCPL_DEFINITION_INPUT, wordOrder: "little" });
  expect(records(little, BCPL_SAMPLE)[0]?.values).toEqual({
    treated_water_flow_klh: 2.718295993743181e23,
    outlet_flow_totalizer_kl: 2.626785157928289e-17,
  });
}

/** 2b — the byte-order twin: swapping the bytes in each word changes the value. */
export function theByteOrderTwinDecodesDifferently(): void {
  const swapped = withReadings([{ key: "w", register: { path: ["Data"], index: 7, type: "uint16" } }], {
    byteOrder: "little",
  });
  // 0xBA6F with its bytes swapped is 0x6FBA.
  expect(records(swapped, BCPL_SAMPLE)[0]?.values.w).toBe(0x6fba);
}

/** 3 — a signed word is taken as its 16-bit pattern. */
export function aSignedWordIsItsSixteenBitPattern(): void {
  const as = (type: string) =>
    records(withReadings([{ key: "w", register: { path: ["Data"], index: 7, type } }]), BCPL_SAMPLE)[0]
      ?.values.w;
  expect(as("int16")).toBe(-17809);
  expect(as("uint16")).toBe(47727);
  expect(as("int32")).toBe(((0xba6f << 16) | 0x00b1) | 0);
  expect(as("uint32")).toBe(0xba6f00b1);
}

/** 3b — float64 spans four words. */
export function aFloat64SpansFourWords(): void {
  // 1.5 as float64 BE = 3FF8 0000 0000 0000.
  const def = withReadings([{ key: "d", register: { path: ["Data"], index: 0, type: "float64" } }]);
  const raw = JSON.stringify([{ TagName: "X", Data: [0x3ff8, 0, 0, 0] }]);
  expect(records(def, raw)[0]?.values.d).toBe(1.5);
}

/** 4 — PHE golden: the builtin kind is `parseMqttEnvelope`, unchanged. */
export function thePheGoldenSampleMatchesTheEnvelopeParse(): void {
  const raw = JSON.stringify({ dev_id: "PHE-1", ts: 1700000000000, values: { a: 1 }, rssi: -70 });
  const decoded = records(MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION, raw);
  const envelope = parseMqttEnvelope(raw);
  expect(decoded).toEqual([{ deviceKey: envelope.devId, values: envelope.values, at: envelope.at }]);
  expect(decoded[0]).toEqual({ deviceKey: "PHE-1", values: { a: 1, rssi: -70 }, at: new Date(1700000000000) });
  // A missing dev_id stays "" (routed nowhere, as before), and bad JSON is not-json.
  expect(records(MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION, "{}")[0]?.deviceKey).toBe("");
  expect(decodeMqttPayload(MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION, "t", utf8("{"))).toEqual({
    ok: false,
    reason: "not-json",
  });
  expect(decodeMqttPayload(MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION, "t", utf8("null"))).toEqual({
    ok: false,
    reason: "not-json",
  });
}

/** 5 — absence: short array or NaN is `null`, an absent path is omitted, never zero. */
export function absentReadingsAreNullOrOmitted(): void {
  const short = JSON.stringify([{ TagName: "X", Timestamp: "1", Data: [16294, 26214, 81, 18230] }]);
  expect(records(bcpl(), short)[0]?.values).toEqual({
    treated_water_flow_klh: 1.2999999523162842,
    outlet_flow_totalizer_kl: null,
  });
  const noData = JSON.stringify([{ TagName: "X" }]);
  expect(records(bcpl(), noData)[0]?.values).toEqual({});
  // 0x7FC0 0000 is a float32 NaN; 0x7F80 0000 is +Infinity.
  const nan = JSON.stringify([{ TagName: "X", Data: [0x7fc0, 0, 0, 0x7f80, 0] }]);
  expect(records(bcpl(), nan)[0]?.values).toEqual({
    treated_water_flow_klh: null,
    outlet_flow_totalizer_kl: null,
  });
  // A non-integer or out-of-range register, or a non-array, is null.
  const bad = JSON.stringify([{ TagName: "X", Data: [1.5, 0, 0, 70000, 0] }]);
  expect(records(bcpl(), bad)[0]?.values).toEqual({
    treated_water_flow_klh: null,
    outlet_flow_totalizer_kl: null,
  });
  expect(records(bcpl(), JSON.stringify([{ TagName: "X", Data: "x" }]))[0]?.values).toEqual({
    treated_water_flow_klh: null,
    outlet_flow_totalizer_kl: null,
  });
}

/** 5b — field readings: numbers and numeric strings; anything else is null. */
export function fieldReadingsAcceptNumbersAndNumericStrings(): void {
  const def = withReadings([
    { key: "a", field: ["v", "a"] },
    { key: "b", field: ["v", "b"] },
    { key: "c", field: ["v", "c"] },
    { key: "d", field: ["v", "d"] },
    { key: "e", field: ["v", "e"] },
    { key: "f", field: ["v", "missing"] },
  ]);
  const raw = JSON.stringify([{ TagName: "X", v: { a: 2.5, b: "3", c: "abc", d: "", e: null } }]);
  expect(records(def, raw)[0]?.values).toEqual({ a: 2.5, b: 3, c: null, d: null, e: null });
}

/** 6 — time units; an unparsable time leaves `at` absent. */
export function timeUnitsAndBadTimes(): void {
  const at = (unit: string, value: unknown) =>
    records(
      withReadings([{ key: "a", field: ["a"] }], { time: { path: ["T"], unit } }),
      JSON.stringify([{ TagName: "X", T: value, a: 1 }]),
    )[0]?.at;
  expect(at("epoch_ms", 1794077986000)?.toISOString()).toBe("2026-11-07T18:59:46.000Z");
  expect(at("epoch_ms", "1794077986000")?.toISOString()).toBe("2026-11-07T18:59:46.000Z");
  expect(at("epoch_s", 1794077986)?.toISOString()).toBe("2026-11-07T18:59:46.000Z");
  expect(at("iso8601", "2026-11-07T18:59:46Z")?.toISOString()).toBe("2026-11-07T18:59:46.000Z");
  expect(at("epoch_s", "abc")).toBeUndefined();
  expect(at("epoch_s", "")).toBeUndefined();
  expect(at("epoch_s", null)).toBeUndefined();
  expect(at("iso8601", "not a date")).toBeUndefined();
  expect(at("iso8601", 1794077986)).toBeUndefined();
  expect(at("epoch_ms", 1e20)).toBeUndefined();
  const noTime = records(withReadings([{ key: "a", field: ["a"] }], { time: undefined }), JSON.stringify([{ TagName: "X", a: 1 }]));
  expect(noTime[0]).toEqual({ deviceKey: "X", values: { a: 1 } });
  expect(Object.prototype.hasOwnProperty.call(noTime[0], "at")).toBe(false);
}

/** 7 — no device-key path: the topic is the key; an empty key fails. */
export function theTopicIsTheKeyWhenNoPathIsSet(): void {
  const def = mqttPayloadFormatDefinitionSchema.parse({
    kind: "declarative",
    root: "object",
    readings: [{ key: "a", field: ["a"] }],
  });
  expect(records(def, JSON.stringify({ a: 1 }), "site/meter-1")[0]?.deviceKey).toBe("site/meter-1");
  expect(decodeMqttPayload(bcpl(), "t", utf8(JSON.stringify([{ TagName: "" }])))).toEqual({
    ok: false,
    reason: "no-device-key",
  });
  expect(decodeMqttPayload(bcpl(), "t", utf8(JSON.stringify([{ TagName: { x: 1 } }])))).toEqual({
    ok: false,
    reason: "no-device-key",
  });
  expect(records(bcpl(), JSON.stringify([{ TagName: 42 }]))[0]?.deviceKey).toBe("42");
}

/** 8 — root checks, caps, bad JSON, and the decoder never throws. */
export function rootCapsAndTotality(): void {
  expect(decodeMqttPayload(bcpl(), "t", utf8(JSON.stringify({ TagName: "X" })))).toEqual({
    ok: false,
    reason: "root-mismatch",
  });
  expect(decodeMqttPayload(bcpl(), "t", utf8(JSON.stringify([1])))).toEqual({ ok: false, reason: "root-mismatch" });
  const many = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ TagName: `D${i}` })));
  expect(decodeMqttPayload(bcpl(), "t", utf8(many(64))).ok).toBe(true);
  expect(decodeMqttPayload(bcpl(), "t", utf8(many(65)))).toEqual({ ok: false, reason: "too-many-records" });
  expect(decodeMqttPayload(bcpl(), "t", utf8("not json"))).toEqual({ ok: false, reason: "not-json" });
  expect(records(bcpl(), "[]")).toEqual([]);
  const objectRoot = mqttPayloadFormatDefinitionSchema.parse({ ...BCPL_DEFINITION_INPUT, root: "object" });
  expect(decodeMqttPayload(objectRoot, "t", utf8("[]"))).toEqual({ ok: false, reason: "root-mismatch" });
  const fuzz = [
    "",
    "{",
    "null",
    "true",
    "1",
    '"x"',
    "[null]",
    "[[]]",
    '[{"TagName":null}]',
    '[{"TagName":"X","Data":null}]',
    '[{"TagName":"X","Data":[null,null,null,null,null]}]',
    '[{"TagName":"X","Data":{"0":1}}]',
    '[{"TagName":"X","Timestamp":{}}]',
    '{"__proto__":{"x":1}}',
    '[{"__proto__":{"TagName":"Y"}}]',
    '[{"TagName":"X","Data":[1e400]}]',
    "[" + "1,".repeat(100) + "1]",
    '{"dev_id":{"a":1}}',
    '{"values":null}',
    "\u0000",
  ];
  for (const raw of fuzz) {
    for (const definition of [bcpl(), objectRoot, MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION]) {
      expect(() => decodeMqttPayload(definition, "t", utf8(raw)), raw).not.toThrow();
    }
  }
  // A prototype-named key in the payload is never walked into.
  expect(decodeMqttPayload(bcpl(), "t", utf8('[{"__proto__":{"TagName":"Y"}}]'))).toEqual({
    ok: false,
    reason: "no-device-key",
  });
}

/** 9 — scale and offset are applied after the register decode. */
export function scaleAndOffsetApply(): void {
  const def = withReadings([
    { key: "f", register: { path: ["Data"], index: 0, type: "float32" }, scale: 0.001, offset: 5 },
  ]);
  const value = records(def, BCPL_SAMPLE)[0]?.values.f as number;
  expect(Math.abs(value - (1.2999999523162842 * 0.001 + 5))).toBeLessThan(1e-9);
}

// --- F4.343 T1.3: the decoder takes bytes (ADR 0119 decision 2) ---------------

/** 10 — binary bytes reach a JSON kind as `not-json`; the binary kind dispatches. */
export function theDecoderTakesBytesForEveryKind(): void {
  const goat = bytesOf(WBLDC_GOAT_HEX);
  for (const definition of [MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION, bcpl()]) {
    expect(decodeMqttPayload(definition, "t", goat)).toEqual({ ok: false, reason: "not-json" });
  }
  const wbldc: MqttPayloadFormatDefinition = mqttPayloadFormatDefinitionSchema.parse(WBLDC_DEFINITION_INPUT);
  expect(wbldc.kind).toBe("binary");
  const decoded = decodeMqttPayload(wbldc, "Haringhata_GOAT", goat);
  expect(decoded.ok && decoded.records[0]?.values.temp_ch0).toBe(27.1);
  // A JSON message is not a binary record, whatever its length.
  expect(decodeMqttPayload(wbldc, "t", utf8(BCPL_SAMPLE))).toEqual({ ok: false, reason: "binary-length-mismatch" });
}

/** 11 — a JSON frame inside a pooled buffer (`byteOffset` ≠ 0) decodes as its own bytes. */
export function aJsonFrameInsideALargerBufferDecodes(): void {
  const pool = utf8(`xxxx${BCPL_SAMPLE}yyyy`);
  const frame = pool.subarray(4, pool.length - 4);
  expect(frame.byteOffset).toBeGreaterThan(0);
  expect(decodeMqttPayload(bcpl(), "t", frame)).toEqual(decodeMqttPayload(bcpl(), "t", utf8(BCPL_SAMPLE)));
  expect(new TextDecoder().decode(frame)).toBe(BCPL_SAMPLE);
  // A leading BOM stays in the text, as `Buffer.toString("utf8")` kept it: not JSON.
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("{}")]);
  expect(decodeMqttPayload(MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION, "t", bom)).toEqual({ ok: false, reason: "not-json" });
}

/** 12 — an unparsed binary definition that reads past its length is a drop, never a throw. */
export function anUnparsedBinaryDefinitionNeverThrows(): void {
  const unparsed = {
    kind: "binary",
    length: 2,
    byteOrder: "little",
    readings: [{ key: "late", byte: 1, type: "float64" }],
  } as MqttPayloadFormatDefinition;
  expect(decodeMqttPayload(unparsed, "t", new Uint8Array(2))).toEqual({ ok: false, reason: "binary-length-mismatch" });
}
