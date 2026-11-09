import { expect } from "vitest";

import { MQTT_DECODE_FAILURES, type MqttDecodedRecord } from "./mqtt-payload-format";
import {
  type MqttBinaryPayloadFormat,
  decodeBinary,
  hexToBytes,
  mqttBinaryPayloadFormatSchema,
} from "./mqtt-payload-format-binary";

/**
 * `F4.343` / ADR 0119 decisions 1 and 2 — the binary schema and decoder.
 * Golden samples: the WBLDC frames captured 2026-11-09 (hex only, no login).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

/** Bytes 0–3 (per topic) and six LE `uint16`: 2026-11-09 15:36:00 IST. */
const HEADER = "f2f01051" + "ea07" + "0b00" + "0900" + "0f00" + "2400" + "0000";

/** `Haringhata_GOAT`: channels 271, 259, −84, 42 tenths of °C, then zeros. */
export const WBLDC_GOAT_HEX = HEADER + "0f010301acff2a00" + "00".repeat(76);
/** `Haringhata_VAP`: −151, 52, then the fault codes `0x8001` and `0x8002`. */
export const WBLDC_VAP_HEX = HEADER + "69ff340001800280" + "00".repeat(76);
/** `Haringhata_RAW`: every channel reads zero. */
export const WBLDC_RAW_HEX = HEADER + "00".repeat(84);

/** The `wbldc-temp-100` definition, as migration `0135` seeds it (ADR 0119 decision 6). */
export const WBLDC_DEFINITION_INPUT = {
  kind: "binary",
  length: 100,
  byteOrder: "little",
  time: {
    fields: { year: 4, month: 6, day: 8, hour: 10, minute: 12, second: 14 },
    utcOffsetMinutes: 330,
  },
  readings: Array.from({ length: 16 }, (_, i) => ({
    key: `temp_ch${i}`,
    byte: 16 + i * 2,
    type: "int16",
    scale: 0.1,
    sentinels: [-32767, -32766],
  })),
} as const;

export const bytesOf = (hex: string): Uint8Array => {
  const bytes = hexToBytes(hex);
  if (bytes === null) {
    throw new Error("fixture is not hex");
  }
  return bytes;
};

const wbldc = (extra: Record<string, unknown> = {}): MqttBinaryPayloadFormat =>
  mqttBinaryPayloadFormatSchema.parse({ ...WBLDC_DEFINITION_INPUT, ...extra });

const parses = (input: unknown): boolean => mqttBinaryPayloadFormatSchema.safeParse(input).success;

const issuePaths = (input: unknown): (string | number)[][] => {
  const result = mqttBinaryPayloadFormatSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path);
};

function record(definition: MqttBinaryPayloadFormat, raw: Uint8Array, topic = "Haringhata_GOAT"): MqttDecodedRecord {
  const result = decodeBinary(definition, topic, raw);
  if (!result.ok || result.records.length !== 1) {
    throw new Error(`expected one record, got ${result.ok ? result.records.length : result.reason}`);
  }
  return result.records[0] as MqttDecodedRecord;
}

/** A 100-byte frame with the given little-endian `uint16` date fields. */
function withDate(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Uint8Array {
  const bytes = bytesOf(WBLDC_GOAT_HEX);
  const view = new DataView(bytes.buffer);
  [y, mo, d, h, mi, s].forEach((value, i) => view.setUint16(4 + i * 2, value, true));
  return bytes;
}

// --- T1.1 schema -------------------------------------------------------------

export function theWbldcDefinitionParses(): void {
  const parsed = wbldc();
  expect(parsed.kind).toBe("binary");
  expect(parsed.readings).toHaveLength(16);
}

export function theSchemaRefusesBadShapes(): void {
  const { byteOrder: _b, ...noOrder } = WBLDC_DEFINITION_INPUT;
  expect(issuePaths(noOrder)).toContainEqual(["byteOrder"]);
  expect(parses({ ...WBLDC_DEFINITION_INPUT, length: 0 })).toBe(false);
  expect(parses({ ...WBLDC_DEFINITION_INPUT, length: 4097 })).toBe(false);
  const pastTheEnd = [...WBLDC_DEFINITION_INPUT.readings, { key: "late", byte: 99, type: "int16" }];
  expect(issuePaths({ ...WBLDC_DEFINITION_INPUT, readings: pastTheEnd })).toContainEqual(["readings", 16, "byte"]);
  expect(parses({ ...WBLDC_DEFINITION_INPUT, readings: [{ key: "edge", byte: 98, type: "int16" }] })).toBe(true);
  const nineSentinels = [{ key: "a", byte: 16, type: "int16", sentinels: [1, 2, 3, 4, 5, 6, 7, 8, 9] }];
  expect(parses({ ...WBLDC_DEFINITION_INPUT, readings: nineSentinels })).toBe(false);
  const floatSentinel = [{ key: "a", byte: 16, type: "float32", sentinels: [1] }];
  expect(issuePaths({ ...WBLDC_DEFINITION_INPUT, readings: floatSentinel })).toContainEqual([
    "readings",
    0,
    "sentinels",
  ]);
  const lateYear = { ...WBLDC_DEFINITION_INPUT.time, fields: { ...WBLDC_DEFINITION_INPUT.time.fields, year: 99 } };
  expect(issuePaths({ ...WBLDC_DEFINITION_INPUT, time: lateYear })).toContainEqual(["time", "fields", "year"]);
  expect(issuePaths({ ...WBLDC_DEFINITION_INPUT, time: { byte: 97, type: "uint32", unit: "epoch_s" } })).toContainEqual(
    ["time", "byte"],
  );
  expect(parses({ ...WBLDC_DEFINITION_INPUT, time: { ...WBLDC_DEFINITION_INPUT.time, utcOffsetMinutes: 841 } })).toBe(
    false,
  );
  expect(parses({ ...WBLDC_DEFINITION_INPUT, script: "x" })).toBe(false);
  expect(parses({ ...WBLDC_DEFINITION_INPUT, readings: [{ key: "a", byte: 16, type: "int16", extra: 1 }] })).toBe(
    false,
  );
  expect(parses({ ...WBLDC_DEFINITION_INPUT, readings: [{ key: "a", byte: 16, type: "int24" }] })).toBe(false);
  expect(parses({ ...WBLDC_DEFINITION_INPUT, readings: [{ key: "__proto__", byte: 16, type: "int16" }] })).toBe(false);
  const duplicate = [
    { key: "a", byte: 16, type: "int16" },
    { key: "a", byte: 18, type: "int16" },
  ];
  expect(issuePaths({ ...WBLDC_DEFINITION_INPUT, readings: duplicate })).toContainEqual(["readings", 1, "key"]);
}

export function theReadingsCapIs128(): void {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, byte: i, type: "uint8" }));
  expect(parses({ ...WBLDC_DEFINITION_INPUT, length: 200, readings: many(128) })).toBe(true);
  expect(parses({ ...WBLDC_DEFINITION_INPUT, length: 200, readings: many(129) })).toBe(false);
  expect(parses({ ...WBLDC_DEFINITION_INPUT, readings: [] })).toBe(false);
}

// --- T1.2 decoder ------------------------------------------------------------

/** 1 — the GOAT golden sample. */
export function theGoatGoldenSampleDecodes(): void {
  const decoded = record(wbldc(), bytesOf(WBLDC_GOAT_HEX));
  expect(decoded.deviceKey).toBe("Haringhata_GOAT");
  expect(decoded.at?.toISOString()).toBe("2026-11-09T10:06:00.000Z");
  expect(decoded.values.temp_ch0).toBe(27.1);
  expect(decoded.values.temp_ch1).toBe(25.900000000000002);
  expect(decoded.values.temp_ch2).toBe(-8.4);
  expect(decoded.values.temp_ch3).toBe(4.2);
  expect(decoded.values.temp_ch15).toBe(0);
  expect(Object.keys(decoded.values)).toHaveLength(16);
}

/** 2 — the byte-order twin: dropping the endian flag reddens 1 and 2 together. */
export function theByteOrderTwinDecodesDifferently(): void {
  const decoded = record(wbldc({ byteOrder: "big" }), bytesOf(WBLDC_GOAT_HEX));
  expect(decoded.values.temp_ch0).toBe(384.1);
  // The year reads 0xEA07 = 59911, past 9999: no time.
  expect(decoded.at).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(decoded, "at")).toBe(false);
}

/** 3 — the VAP golden sample: the two fault codes leave their channels absent. */
export function theVapFaultCodesAreAbsent(): void {
  const decoded = record(wbldc(), bytesOf(WBLDC_VAP_HEX), "Haringhata_VAP");
  expect(decoded.deviceKey).toBe("Haringhata_VAP");
  expect(decoded.values.temp_ch0).toBe(-15.100000000000001);
  expect(decoded.values.temp_ch1).toBe(5.2);
  expect("temp_ch2" in decoded.values).toBe(false);
  expect("temp_ch3" in decoded.values).toBe(false);
  expect(Object.keys(decoded.values)).toHaveLength(14);
}

/** 4 — the RAW golden sample: every channel is zero, and the time is present. */
export function theRawGoldenSampleIsAllZero(): void {
  const decoded = record(wbldc(), bytesOf(WBLDC_RAW_HEX), "Haringhata_RAW");
  expect(Object.values(decoded.values)).toEqual(Array.from({ length: 16 }, () => 0));
  expect(decoded.at?.toISOString()).toBe("2026-11-09T10:06:00.000Z");
}

/** 5 — any other length is `binary-length-mismatch`, a listed failure. */
export function anotherLengthIsAMismatch(): void {
  const goat = bytesOf(WBLDC_GOAT_HEX);
  const longer = new Uint8Array(101);
  longer.set(goat);
  for (const raw of [goat.subarray(0, 99), longer]) {
    expect(decodeBinary(wbldc(), "t", raw)).toEqual({ ok: false, reason: "binary-length-mismatch" });
  }
  expect(MQTT_DECODE_FAILURES).toContain("binary-length-mismatch");
}

/** 6 — a view part-way into a larger buffer (a pooled `Buffer`) reads its own bytes. */
export function aViewIntoALargerBufferDecodes(): void {
  const big = new Uint8Array(120).fill(0x55);
  big.set(bytesOf(WBLDC_GOAT_HEX), 7);
  const view = big.subarray(7, 107);
  expect(view.byteOffset).toBe(7);
  expect(record(wbldc(), view)).toEqual(record(wbldc(), bytesOf(WBLDC_GOAT_HEX)));
}

/** 7 — date fields, offsets, impossible dates and the epoch variant. */
export function timesAndImpossibleDates(): void {
  const def = wbldc();
  expect(record(def, withDate(0, 0, 0)).at).toBeUndefined();
  expect(record(def, withDate(2026, 13, 1)).at).toBeUndefined();
  expect(record(def, withDate(2026, 2, 31)).at).toBeUndefined();
  expect(record(def, withDate(2026, 11, 9, 24)).at).toBeUndefined();
  expect(record(def, withDate(1969, 12, 31)).at).toBeUndefined();
  expect(record(def, withDate(2028, 2, 29, 5, 30)).at?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  const utc = wbldc({ time: { ...WBLDC_DEFINITION_INPUT.time, utcOffsetMinutes: 0 } });
  expect(record(utc, bytesOf(WBLDC_GOAT_HEX)).at?.toISOString()).toBe("2026-11-09T15:36:00.000Z");

  const epoch = (unit: string, value: number) => {
    const bytes = bytesOf(WBLDC_GOAT_HEX);
    new DataView(bytes.buffer).setUint32(4, value, true);
    return record(wbldc({ time: { byte: 4, type: "uint32", unit } }), bytes).at?.toISOString();
  };
  expect(epoch("epoch_s", 1794218760)).toBe("2026-11-09T10:06:00.000Z");
  expect(epoch("epoch_ms", 1794207960)).toBe("1970-01-21T18:23:27.960Z");
  expect(epoch("epoch_s", 0)).toBe("1970-01-01T00:00:00.000Z");
}

/** 8 — every field type, NaN, and a per-reading byte order. */
export function everyFieldTypeReads(): void {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0xff;
  view.setFloat32(4, 1.3, true);
  view.setFloat64(8, -2.5, true);
  view.setUint32(16, 0xdeadbeef, true);
  view.setInt32(20, -123456, true);
  view.setUint32(24, 0x7fc00000, true); // a float32 NaN
  view.setUint16(28, 0x1234, false); // big-endian, read with a per-reading override
  const def = mqttBinaryPayloadFormatSchema.parse({
    kind: "binary",
    length: 32,
    byteOrder: "little",
    readings: [
      { key: "i8", byte: 0, type: "int8" },
      { key: "u8", byte: 0, type: "uint8" },
      { key: "f32", byte: 4, type: "float32" },
      { key: "f64", byte: 8, type: "float64" },
      { key: "u32", byte: 16, type: "uint32" },
      { key: "i32", byte: 20, type: "int32" },
      { key: "nan", byte: 24, type: "float32" },
      { key: "be", byte: 28, type: "uint16", byteOrder: "big" },
      { key: "le", byte: 28, type: "uint16" },
      { key: "affine", byte: 0, type: "uint8", scale: 2, offset: -10 },
    ],
  });
  const decoded = record(def, bytes, "t");
  expect(decoded.values).toEqual({
    i8: -1,
    u8: 255,
    f32: 1.2999999523162842,
    f64: -2.5,
    u32: 0xdeadbeef,
    i32: -123456,
    nan: null,
    be: 0x1234,
    le: 0x3412,
    affine: 500,
  });
  expect(decoded.at).toBeUndefined();
}

/** 9 — `hexToBytes` and the decoder are total. */
export function hexAndTotality(): void {
  expect(Array.from(hexToBytes("f2 f0\n10 51") ?? [])).toEqual([0xf2, 0xf0, 0x10, 0x51]);
  expect(hexToBytes("F2F0")).toEqual(new Uint8Array([0xf2, 0xf0]));
  expect(hexToBytes("f2f")).toBeNull();
  expect(hexToBytes("0xf2")).toBeNull();
  expect(hexToBytes("zz")).toBeNull();
  expect(hexToBytes("")).toEqual(new Uint8Array(0));
  const allFf = new Uint8Array(100).fill(0xff);
  for (const raw of [new Uint8Array(0), new Uint8Array(4096), allFf]) {
    expect(() => decodeBinary(wbldc(), "t", raw)).not.toThrow();
  }
  // 0xFFFF everywhere: every channel reads −1 → −0.1; the year 65535 is no date.
  const decoded = record(wbldc(), allFf);
  expect(decoded.values.temp_ch0).toBe(-0.1);
  expect(decoded.at).toBeUndefined();
}
