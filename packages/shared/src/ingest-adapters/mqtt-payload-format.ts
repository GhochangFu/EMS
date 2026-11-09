import { z } from "zod";

import { parseMqttEnvelope } from "./mqtt-envelope";
import {
  decodeBinary,
  mqttBinaryPayloadFormatObjectSchema,
  mqttBinaryPayloadFormatSchema,
  refineBinary,
} from "./mqtt-payload-format-binary";
import { MQTT_FORBIDDEN_SEGMENTS, mqttPayloadReadingKeySchema } from "./mqtt-payload-keys";

/**
 * MQTT payload formats (ADR 0116 decisions 2 and 3, `F4.334`).
 *
 * A format **definition** is data, never code: no expression, no script and no
 * regular expression supplied by an admin. One schema here validates it for the
 * API, the worker, the ingest host and the web; one pure function,
 * `decodeMqttPayload`, turns a message into zero or more device records.
 *
 * Two kinds (plan R2, ruling 16):
 * - `builtin` — the ThinkIoT envelope. Its decoder **is** `parseMqttEnvelope`,
 *   unchanged, so every RTU without a `payloadFormat` behaves as before.
 * - `declarative` — named JSON fields and numeric register arrays.
 * - `binary` — a fixed-length binary record (ADR 0119; `mqtt-payload-format-binary.ts`).
 *
 * The decoder takes the message's **bytes** (ADR 0119 decision 2): `builtin`
 * and `declarative` read them as UTF-8 exactly as `Buffer.toString("utf8")`
 * did, and `binary` reads them with a `DataView`.
 */

/** `bms.mqtt_payload_formats.code`: kebab-case, at most 64 characters. */
export const MQTT_PAYLOAD_FORMAT_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MQTT_PAYLOAD_FORMAT_CODE_MAX = 64;
/** The built-in envelope's code; also what an RTU without `payloadFormat` uses. */
export const MQTT_BUILTIN_PAYLOAD_FORMAT_CODE = "thinkiot-envelope";
/** Records one array-root message may carry (ruling 2). */
export const MQTT_PAYLOAD_FORMAT_ARRAY_CAP = 64;
/** Readings one format may define (ruling 2). */
export const MQTT_PAYLOAD_FORMAT_READINGS_CAP = 128;
/** Segments in one field path (ruling 2). */
export const MQTT_PAYLOAD_FORMAT_PATH_MAX = 8;
/** Longest device key a declarative format yields; longer is `no-device-key`. */
export const MQTT_PAYLOAD_FORMAT_DEVICE_KEY_MAX = 255;

/**
 * The fixed refusal for a `payloadFormat` that is not in the catalog (ADR 0116
 * decision 4). Names no code (§9.6, the validator's fixed-text rule).
 */
export const MQTT_PAYLOAD_FORMAT_UNKNOWN_MESSAGE =
  "payloadFormat does not name a payload format in the catalog";

/** The shared code schema, for `mqttConfigSchema` and the catalog contracts. */
export const mqttPayloadFormatCodeSchema = z
  .string()
  .max(MQTT_PAYLOAD_FORMAT_CODE_MAX, "a payload format code is at most 64 characters")
  .regex(MQTT_PAYLOAD_FORMAT_CODE, "a payload format code is lower-case words joined by hyphens");

/** One path segment: an own property name, or an array index. */
const pathSegmentSchema = z.union([
  z
    .string()
    .min(1)
    .max(64)
    .refine((segment) => !MQTT_FORBIDDEN_SEGMENTS.has(segment), {
      message: "a path segment may not name a prototype property",
    }),
  z.number().int().nonnegative(),
]);

/** A field path: a list of 1–8 segments. No dotted string, so no parser and no regex. */
export const mqttPayloadFieldPathSchema = z
  .array(pathSegmentSchema)
  .min(1)
  .max(MQTT_PAYLOAD_FORMAT_PATH_MAX);

export type MqttPayloadFieldPath = z.infer<typeof mqttPayloadFieldPathSchema>;

export const MQTT_REGISTER_TYPES = ["int16", "uint16", "int32", "uint32", "float32", "float64"] as const;
export type MqttRegisterType = (typeof MQTT_REGISTER_TYPES)[number];

/** Words (16-bit registers) each type spans. */
const WORDS: Record<MqttRegisterType, number> = {
  int16: 1,
  uint16: 1,
  int32: 2,
  uint32: 2,
  float32: 2,
  float64: 4,
};

const affine = {
  /** Multiplier applied before the point's own `scale_multiplier`. */
  scale: z.number().finite().optional(),
  /** Added after `scale`, before the point's own `scale_offset`. */
  offset: z.number().finite().optional(),
};

/** A reading taken from one JSON field (a number or a numeric string). */
const fieldReadingSchema = z
  .object({ key: mqttPayloadReadingKeySchema, field: mqttPayloadFieldPathSchema, ...affine })
  .strict();

/** A reading taken from a numeric array of 16-bit registers, starting at `index`. */
const registerReadingSchema = z
  .object({
    key: mqttPayloadReadingKeySchema,
    register: z
      .object({
        path: mqttPayloadFieldPathSchema,
        index: z.number().int().nonnegative().max(65_535),
        type: z.enum(MQTT_REGISTER_TYPES),
      })
      .strict(),
    ...affine,
  })
  .strict();

const readingSchema = z.union([fieldReadingSchema, registerReadingSchema]);

export type MqttPayloadReading = z.infer<typeof readingSchema>;

export const MQTT_TIME_UNITS = ["epoch_s", "epoch_ms", "iso8601"] as const;

const byteOrderSchema = z.enum(["big", "little"]);

/** The built-in ThinkIoT envelope (ruling 16): stored, never edited. */
const builtinDefinitionSchema = z
  .object({ kind: z.literal("builtin"), name: z.literal(MQTT_BUILTIN_PAYLOAD_FORMAT_CODE) })
  .strict();

/** The declarative definition's shape, before its cross-field rule (for the editable union). */
const declarativeObjectSchema = z
  .object({
    kind: z.literal("declarative"),
    root: z.enum(["object", "array"]),
    /** Absent: the topic is the device key (ADR 0116 R5). */
    deviceKey: mqttPayloadFieldPathSchema.optional(),
    time: z
      .object({ path: mqttPayloadFieldPathSchema, unit: z.enum(MQTT_TIME_UNITS) })
      .strict()
      .optional(),
    /** Order of the 16-bit words inside a multi-word value. */
    wordOrder: byteOrderSchema.default("big"),
    /** Order of the two bytes inside each 16-bit word. */
    byteOrder: byteOrderSchema.default("big"),
    readings: z.array(readingSchema).min(1).max(MQTT_PAYLOAD_FORMAT_READINGS_CAP),
  })
  .strict();

function refineDeclarative(definition: z.infer<typeof declarativeObjectSchema>, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  definition.readings.forEach((reading, index) => {
    if (seen.has(reading.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["readings", index, "key"],
        message: "two readings may not share a key",
      });
    }
    seen.add(reading.key);
  });
}

/** A declarative definition (ADR 0116 decision 3, rulings 2, 3, 14). */
export const mqttDeclarativePayloadFormatSchema = declarativeObjectSchema.superRefine(refineDeclarative);

export const mqttPayloadFormatDefinitionSchema = z.union([
  builtinDefinitionSchema,
  mqttDeclarativePayloadFormatSchema,
  mqttBinaryPayloadFormatSchema,
]);

/**
 * What an admin may create or edit (`POST`/`PUT`): never `builtin` (ruling 16).
 * Discriminated on `kind` (ADR 0119), so a non-object is still "Expected
 * object" and a wrong field names its own path within the chosen kind, as the
 * single declarative schema did — never a bare "Invalid input".
 */
export const mqttEditablePayloadFormatSchema = z
  .discriminatedUnion("kind", [declarativeObjectSchema, mqttBinaryPayloadFormatObjectSchema])
  .superRefine((definition, ctx) =>
    definition.kind === "binary" ? refineBinary(definition, ctx) : refineDeclarative(definition, ctx),
  );

export type MqttPayloadFormatDefinition = z.infer<typeof mqttPayloadFormatDefinitionSchema>;
export type MqttDeclarativePayloadFormat = z.infer<typeof mqttDeclarativePayloadFormatSchema>;

/** The built-in definition literal, as the migration stores it. */
export const MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION: MqttPayloadFormatDefinition = {
  kind: "builtin",
  name: MQTT_BUILTIN_PAYLOAD_FORMAT_CODE,
};

/** One device's readings from one message. */
export type MqttDecodedRecord = {
  deviceKey: string;
  /** Absent when the message carries no usable time — never `Date.now()` (ADR 0061). */
  at?: Date;
  /**
   * Keyed by `source_data_key`. A declarative reading is a finite number, or
   * `null` when present but unusable (short register array, NaN, ±Infinity,
   * a non-numeric field); a reading whose path is absent is omitted (ruling 14).
   */
  values: Record<string, unknown>;
};

export const MQTT_DECODE_FAILURES = [
  "not-json",
  "root-mismatch",
  "no-device-key",
  "too-many-records",
  // ADR 0119: a binary message whose length is not the format's `length`.
  "binary-length-mismatch",
] as const;
export type MqttDecodeFailure = (typeof MQTT_DECODE_FAILURES)[number];

export type MqttDecodeResult =
  | { ok: true; records: MqttDecodedRecord[] }
  | { ok: false; reason: MqttDecodeFailure };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Walks own properties and array indexes only; anything else is `undefined`. */
function valueAt(root: unknown, path: MqttPayloadFieldPath): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) {
        return undefined;
      }
      current = current[segment];
    } else {
      if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
        return undefined;
      }
      current = current[segment];
    }
  }
  return current;
}

/** A finite number from a number or a non-blank numeric string; otherwise `undefined`. */
function numeric(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function timeOf(
  record: Record<string, unknown>,
  time: NonNullable<MqttDeclarativePayloadFormat["time"]>,
): Date | undefined {
  const raw = valueAt(record, time.path);
  let ms: number | undefined;
  if (time.unit === "iso8601") {
    ms = typeof raw === "string" && raw.trim() !== "" ? Date.parse(raw) : undefined;
  } else {
    const n = numeric(raw);
    ms = n === undefined ? undefined : time.unit === "epoch_s" ? n * 1000 : n;
  }
  if (ms === undefined || !Number.isFinite(ms)) {
    return undefined;
  }
  const at = new Date(ms);
  return Number.isFinite(at.getTime()) ? at : undefined;
}

function deviceKeyOf(
  record: Record<string, unknown>,
  path: MqttPayloadFieldPath | undefined,
  topic: string,
): string | undefined {
  const raw = path === undefined ? topic : valueAt(record, path);
  const key =
    typeof raw === "string" ? raw : typeof raw === "number" && Number.isFinite(raw) ? String(raw) : "";
  return key === "" || key.length > MQTT_PAYLOAD_FORMAT_DEVICE_KEY_MAX ? undefined : key;
}

/** A register value as its 16-bit pattern, or `undefined` when it is not a 16-bit integer. */
function word(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -32_768 || value > 65_535) {
    return undefined;
  }
  return value & 0xffff;
}

function registerValue(
  record: Record<string, unknown>,
  register: { path: MqttPayloadFieldPath; index: number; type: MqttRegisterType },
  wordOrder: "big" | "little",
  byteOrder: "big" | "little",
): number | null | undefined {
  const array = valueAt(record, register.path);
  if (array === undefined) {
    return undefined;
  }
  if (!Array.isArray(array)) {
    return null;
  }
  const count = WORDS[register.type];
  const words: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const w = word(array[register.index + i]);
    if (w === undefined) {
      return null;
    }
    words.push(w);
  }
  if (wordOrder === "little") {
    words.reverse();
  }
  const view = new DataView(new ArrayBuffer(count * 2));
  words.forEach((w, i) => {
    const hi = (w >> 8) & 0xff;
    const lo = w & 0xff;
    view.setUint8(i * 2, byteOrder === "big" ? hi : lo);
    view.setUint8(i * 2 + 1, byteOrder === "big" ? lo : hi);
  });
  switch (register.type) {
    case "int16":
      return view.getInt16(0);
    case "uint16":
      return view.getUint16(0);
    case "int32":
      return view.getInt32(0);
    case "uint32":
      return view.getUint32(0);
    case "float32":
      return view.getFloat32(0);
    case "float64":
      return view.getFloat64(0);
  }
}

function readingValue(
  record: Record<string, unknown>,
  reading: MqttPayloadReading,
  definition: MqttDeclarativePayloadFormat,
): number | null | undefined {
  let value: number | null | undefined;
  if ("field" in reading) {
    const raw = valueAt(record, reading.field);
    value = raw === undefined ? undefined : (numeric(raw) ?? null);
  } else {
    value = registerValue(record, reading.register, definition.wordOrder, definition.byteOrder);
  }
  if (value === undefined || value === null) {
    return value;
  }
  const corrected = value * (reading.scale ?? 1) + (reading.offset ?? 0);
  return Number.isFinite(corrected) ? corrected : null;
}

function decodeDeclarative(
  definition: MqttDeclarativePayloadFormat,
  topic: string,
  raw: string,
): MqttDecodeResult {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  let elements: unknown[];
  if (definition.root === "array") {
    if (!Array.isArray(body)) {
      return { ok: false, reason: "root-mismatch" };
    }
    if (body.length > MQTT_PAYLOAD_FORMAT_ARRAY_CAP) {
      return { ok: false, reason: "too-many-records" };
    }
    elements = body;
  } else {
    elements = [body];
  }
  const records: MqttDecodedRecord[] = [];
  for (const element of elements) {
    if (!isPlainObject(element)) {
      return { ok: false, reason: "root-mismatch" };
    }
    const deviceKey = deviceKeyOf(element, definition.deviceKey, topic);
    if (deviceKey === undefined) {
      return { ok: false, reason: "no-device-key" };
    }
    const values: Record<string, unknown> = {};
    for (const reading of definition.readings) {
      const value = readingValue(element, reading, definition);
      if (value !== undefined) {
        values[reading.key] = value;
      }
    }
    const at = definition.time === undefined ? undefined : timeOf(element, definition.time);
    records.push(at === undefined ? { deviceKey, values } : { deviceKey, at, values });
  }
  return { ok: true, records };
}

/**
 * Decodes one MQTT message with one format (ADR 0116 decision 3; ADR 0119
 * decision 2 — the message is bytes). Pure and total: it never throws, and it
 * never echoes the payload in a reason.
 *
 * `builtin` and `declarative` decode the bytes as UTF-8 with a non-fatal
 * `TextDecoder` that keeps a BOM, so invalid bytes become U+FFFD and `JSON.parse` fails as
 * `not-json` — exactly what `Buffer.toString("utf8")` gave before.
 *
 * The built-in kind is `parseMqttEnvelope` wrapped as one record, byte for
 * byte — including a missing `dev_id`, which stays the empty string the ingest
 * adapter has always routed nowhere.
 */
export function decodeMqttPayload(
  definition: MqttPayloadFormatDefinition,
  topic: string,
  raw: Uint8Array,
): MqttDecodeResult {
  if (definition.kind === "binary") {
    try {
      return decodeBinary(definition, topic, raw);
    } catch {
      // Unreachable for a schema-parsed definition; a decoder bug is a drop, not a crash.
      return { ok: false, reason: "binary-length-mismatch" };
    }
  }
  // `ignoreBOM: true` keeps a leading BOM, as `Buffer.toString("utf8")` did.
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(raw);
  if (definition.kind === "builtin") {
    try {
      const parsed = parseMqttEnvelope(text);
      const record: MqttDecodedRecord =
        parsed.at === undefined
          ? { deviceKey: parsed.devId, values: parsed.values }
          : { deviceKey: parsed.devId, at: parsed.at, values: parsed.values };
      return { ok: true, records: [record] };
    } catch {
      return { ok: false, reason: "not-json" };
    }
  }
  try {
    return decodeDeclarative(definition, topic, text);
  } catch {
    // Unreachable by construction; kept so a decoder bug is a drop, not a crash.
    return { ok: false, reason: "not-json" };
  }
}
