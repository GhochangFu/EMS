import { z } from "zod";

import { mqttPayloadReadingKeySchema } from "./mqtt-payload-keys";
import type { MqttDecodeResult, MqttDecodedRecord } from "./mqtt-payload-format";

/**
 * Binary MQTT payload formats (ADR 0119 decisions 1 and 2, `F4.343`).
 *
 * A third definition kind beside ADR 0116's `builtin` and `declarative`: a
 * **fixed-length binary record** read with a `DataView`. It is data, never
 * code — byte positions, types and sentinels, no expression and no script.
 * The device key is always the topic (ruling R4); one message is one record.
 *
 * The byte position of a reading (and of the epoch time) is `byte`, so
 * `scale`/`offset` keep the affine meaning they have in ADR 0116 (plan R3).
 */

/** The longest record a binary format may describe (plan R9; under `MAX_PAYLOAD_BYTES`). */
export const MQTT_BINARY_LENGTH_MAX = 4096;
/** Sentinel values one reading may list (plan R9). */
export const MQTT_BINARY_SENTINELS_MAX = 8;
/** Readings one binary format may define (as ADR 0116's cap). */
export const MQTT_BINARY_READINGS_CAP = 128;

export const MQTT_BINARY_FIELD_TYPES = [
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "float32",
  "float64",
] as const;
export type MqttBinaryFieldType = (typeof MQTT_BINARY_FIELD_TYPES)[number];

/** Bytes each field type spans. */
const BYTES: Record<MqttBinaryFieldType, 1 | 2 | 4 | 8> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
};

const FLOAT_TYPES: ReadonlySet<MqttBinaryFieldType> = new Set(["float32", "float64"]);

/** Every date field is a `uint16` (plan R2). */
const DATE_FIELD_BYTES = 2;
const EPOCH_BYTES = 4;

const byteOrderSchema = z.enum(["big", "little"]);
const bytePositionSchema = z.number().int().nonnegative().max(MQTT_BINARY_LENGTH_MAX - 1);

const DATE_FIELD_NAMES = ["year", "month", "day", "hour", "minute", "second"] as const;

/** Local date fields plus the fixed offset from UTC they are written in (ruling R2). */
const fieldsTimeSchema = z
  .object({
    fields: z
      .object({
        year: bytePositionSchema,
        month: bytePositionSchema,
        day: bytePositionSchema,
        hour: bytePositionSchema,
        minute: bytePositionSchema,
        second: bytePositionSchema,
      })
      .strict(),
    utcOffsetMinutes: z.number().int().min(-720).max(840),
  })
  .strict();

/** A `uint32` epoch at `byte`, read in the definition's byte order. */
const epochTimeSchema = z
  .object({
    byte: bytePositionSchema,
    type: z.literal("uint32"),
    unit: z.enum(["epoch_s", "epoch_ms"]),
  })
  .strict();

const binaryReadingSchema = z
  .object({
    key: mqttPayloadReadingKeySchema,
    byte: bytePositionSchema,
    type: z.enum(MQTT_BINARY_FIELD_TYPES),
    /** Overrides the definition's `byteOrder` for this field only. */
    byteOrder: byteOrderSchema.optional(),
    /** Multiplier applied before the point's own `scale_multiplier`. */
    scale: z.number().finite().optional(),
    /** Added after `scale`, before the point's own `scale_offset`. */
    offset: z.number().finite().optional(),
    /** Raw integer values that make the reading absent (ruling R3). */
    sentinels: z.array(z.number().int()).max(MQTT_BINARY_SENTINELS_MAX).optional(),
  })
  .strict();

/** A binary definition (ADR 0119 decision 1). */
export const mqttBinaryPayloadFormatSchema = z
  .object({
    kind: z.literal("binary"),
    /** The exact message length; any other length is `binary-length-mismatch`. */
    length: z.number().int().min(1).max(MQTT_BINARY_LENGTH_MAX),
    /** Required: a silent default would decode a vendor's numbers plausibly wrong (plan R8). */
    byteOrder: byteOrderSchema,
    time: z.union([fieldsTimeSchema, epochTimeSchema]).optional(),
    readings: z.array(binaryReadingSchema).min(1).max(MQTT_BINARY_READINGS_CAP),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const seen = new Set<string>();
    definition.readings.forEach((reading, index) => {
      if (seen.has(reading.key)) {
        issue(["readings", index, "key"], "two readings may not share a key");
      }
      seen.add(reading.key);
      if (reading.byte + BYTES[reading.type] > definition.length) {
        issue(["readings", index, "byte"], "a reading may not run past the message length");
      }
      if (reading.sentinels !== undefined && FLOAT_TYPES.has(reading.type)) {
        issue(["readings", index, "sentinels"], "sentinels apply to integer readings only");
      }
    });
    const time = definition.time;
    if (time !== undefined && "fields" in time) {
      for (const name of DATE_FIELD_NAMES) {
        if (time.fields[name] + DATE_FIELD_BYTES > definition.length) {
          issue(["time", "fields", name], "a date field may not run past the message length");
        }
      }
    } else if (time !== undefined && time.byte + EPOCH_BYTES > definition.length) {
      issue(["time", "byte"], "the epoch time may not run past the message length");
    }
  });

export type MqttBinaryPayloadFormat = z.infer<typeof mqttBinaryPayloadFormatSchema>;
export type MqttBinaryReading = MqttBinaryPayloadFormat["readings"][number];

function readField(view: DataView, byte: number, type: MqttBinaryFieldType, little: boolean): number {
  switch (type) {
    case "int8":
      return view.getInt8(byte);
    case "uint8":
      return view.getUint8(byte);
    case "int16":
      return view.getInt16(byte, little);
    case "uint16":
      return view.getUint16(byte, little);
    case "int32":
      return view.getInt32(byte, little);
    case "uint32":
      return view.getUint32(byte, little);
    case "float32":
      return view.getFloat32(byte, little);
    case "float64":
      return view.getFloat64(byte, little);
  }
}

const inRange = (n: number, min: number, max: number) => n >= min && n <= max;

/**
 * The record's time, or `undefined` — never `Date.now()` (ADR 0061). A date
 * that does not exist (month 13, 31 February, all zeros) is absent (plan R10).
 */
function timeOf(view: DataView, definition: MqttBinaryPayloadFormat): Date | undefined {
  const time = definition.time;
  if (time === undefined) {
    return undefined;
  }
  const little = definition.byteOrder === "little";
  if (!("fields" in time)) {
    const n = view.getUint32(time.byte, little);
    const at = new Date(time.unit === "epoch_s" ? n * 1000 : n);
    return Number.isFinite(at.getTime()) ? at : undefined;
  }
  const [y, mo, d, h, mi, s] = DATE_FIELD_NAMES.map((name) => view.getUint16(time.fields[name], little)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (
    !inRange(y, 1970, 9999) ||
    !inRange(mo, 1, 12) ||
    !inRange(d, 1, 31) ||
    !inRange(h, 0, 23) ||
    !inRange(mi, 0, 59) ||
    !inRange(s, 0, 59)
  ) {
    return undefined;
  }
  const local = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (local.getUTCMonth() !== mo - 1 || local.getUTCDate() !== d) {
    return undefined;
  }
  return new Date(local.getTime() - time.utcOffsetMinutes * 60_000);
}

/**
 * Decodes one binary message (ADR 0119 decision 2). Pure and total: it never
 * throws, and its one failure reason carries no byte of the payload (§9.6).
 *
 * A reading whose raw integer is one of its `sentinels` is omitted, like an
 * absent JSON path (plan R7); a non-finite float or corrected value is `null`.
 */
export function decodeBinary(
  definition: MqttBinaryPayloadFormat,
  topic: string,
  raw: Uint8Array,
): MqttDecodeResult {
  if (raw.byteLength !== definition.length) {
    return { ok: false, reason: "binary-length-mismatch" };
  }
  // Never `new DataView(raw.buffer)`: a pooled `Buffer` starts part-way in.
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const values: Record<string, unknown> = {};
  for (const reading of definition.readings) {
    const little = (reading.byteOrder ?? definition.byteOrder) === "little";
    const value = readField(view, reading.byte, reading.type, little);
    if (reading.sentinels?.includes(value)) {
      continue;
    }
    const corrected = value * (reading.scale ?? 1) + (reading.offset ?? 0);
    values[reading.key] = Number.isFinite(corrected) ? corrected : null;
  }
  const at = timeOf(view, definition);
  const record: MqttDecodedRecord = at === undefined ? { deviceKey: topic, values } : { deviceKey: topic, at, values };
  return { ok: true, records: [record] };
}

/**
 * A hex sample as bytes (plan R4): whitespace is ignored; anything but an even
 * number of hex digits — a `0x` prefix included — is `null`.
 */
export function hexToBytes(text: string): Uint8Array | null {
  const digits = text.replace(/\s+/g, "");
  if (digits.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(digits)) {
    return null;
  }
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
