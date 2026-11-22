import { z } from "zod";

import { CATALOG_CODE_PATTERN } from "./constants";
// Leaf modules, not `./ingest`: that module re-exports this one, and a runtime
// import back from it would make the schemas depend on entry order.
import { MODBUS_TYPE_WORDS } from "./ingest-adapters/modbus-codec";
import { mqttPayloadReadingKeySchema } from "./ingest-adapters/mqtt-payload-keys";
import { pollIntervalMsSchema } from "./ingest-poll-interval";

/**
 * The Modbus TCP schemas (ADR 0141 decisions 5, 6, 7, 12; Amendment 1 (a);
 * `F1.2`).
 *
 * The adapter's connection slice (`modbusConfigSchema`) and device slice
 * (`modbusDeviceSchema`), the register entry both carry, the onboarding draft
 * schema, and a device profile. The ingest adapter, the API's bind and profile
 * routes, the onboarding validator and the stock-profile spec read these, so
 * none of them can disagree on what a register is.
 *
 * The wire codec (`./ingest-adapters/modbus-codec.ts`) is zod-free and reads
 * only the types below, never this module at runtime; this module reads the
 * codec's word counts, so the import runs one way only.
 *
 * Every issue message is fixed text: none echoes the offending value (§9.6),
 * because the onboarding validator forwards these messages.
 */

/** The four Modbus data tables, named as in the Application Protocol §4.3. */
export const MODBUS_TABLES = ["coil", "discrete", "holding", "input"] as const;
export type ModbusTable = (typeof MODBUS_TABLES)[number];

/** The value types a register entry may decode to (decision 7). */
export const MODBUS_VALUE_TYPES = [
  "bool",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
  "float32",
  "float64",
] as const;
export type ModbusValueType = (typeof MODBUS_VALUE_TYPES)[number];

export const MODBUS_WORD_ORDERS = ["big", "little"] as const;
export type ModbusWordOrder = (typeof MODBUS_WORD_ORDERS)[number];

/** Tables that hold one bit per address: only `bool` fits. */
const BIT_TABLES: ReadonlySet<ModbusTable> = new Set(["coil", "discrete"]);

/**
 * Registers one device may list. 256 keeps a profile body well under Express's
 * 100 KB JSON limit; the migration's CHECK holds the same number (plan C1).
 */
export const MODBUS_REGISTERS_MAX = 256;

/** The highest zero-based protocol address (a 16-bit field, App. Protocol §4.4). */
export const MODBUS_ADDRESS_MAX = 65_535;

/**
 * Unit ids a device may use: a serial address 0–247 behind a gateway, or 255,
 * which the Modbus Messaging on TCP/IP Implementation Guide V1.0b §4.4.1.2
 * names for a device addressed directly over TCP (Amendment 1 (a)).
 */
export const MODBUS_UNIT_ID_MAX_SERIAL = 247;
export const MODBUS_UNIT_ID_DIRECT = 255;

/** A register entry (decision 7). `value = raw × scale + offset`. */
export const modbusRegisterSchema = z
  .object({
    /** The `bms.asset_points.source_data_key` this register feeds. */
    // `.describe()` after each refinement (ADR 0029 Amendment 1 fact F): the profiles API
    // registers bodies that carry this schema, and the document must say what it cannot check.
    sourceKey: mqttPayloadReadingKeySchema.describe(
      "1 to 128 characters; not a prototype property name (__proto__, constructor, prototype)",
    ),
    table: z.enum(MODBUS_TABLES),
    /** Zero-based protocol address, as on the wire. */
    address: z.number().int().min(0).max(MODBUS_ADDRESS_MAX),
    type: z.enum(MODBUS_VALUE_TYPES),
    /** `big`: the most significant word first. Ignored for one-word types. */
    wordOrder: z.enum(MODBUS_WORD_ORDERS).default("big"),
    /** Swap the two bytes inside each word before reading. */
    byteSwap: z.boolean().default(false),
    scale: z.number().finite().default(1),
    offset: z.number().finite().default(0),
    /** Display hint for onboarding only. */
    unit: z.string().min(1).max(32).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (BIT_TABLES.has(entry.table) && entry.type !== "bool") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: "a coil or discrete input register holds one bit; its type must be bool",
      });
    }
    // A float32 at 65535 would need register 65536, which no request can read.
    if (entry.address + MODBUS_TYPE_WORDS[entry.type] - 1 > MODBUS_ADDRESS_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["address"],
        message: "the register's words run past address 65535",
      });
    }
  })
  .describe(
    "A coil or discrete input register has type bool; a register's words may not run past address 65535",
  );

export type ModbusRegister = z.infer<typeof modbusRegisterSchema>;

/** One device's registers: 1 to 256, no `sourceKey` twice. */
export const modbusRegistersSchema = z
  .array(modbusRegisterSchema)
  .min(1)
  .max(MODBUS_REGISTERS_MAX)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.sourceKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "sourceKey"],
          message: "two registers of one device may not share a sourceKey",
        });
      }
      seen.add(entry.sourceKey);
    });
  })
  .describe("No two registers of one device share a sourceKey");

/**
 * A host name or IP literal: no scheme, no path, no port, no whitespace, at
 * most 253 characters (a DNS name's limit). Lower-cased, so `endpointKey` is
 * one string for one gateway however it was typed. One colon is a port or a
 * scheme (`meter:502`, `tcp:meter`) and is refused; an IPv6 literal has two or
 * more and is accepted.
 */
const modbusHostSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((host) => !/[\s/]/.test(host) && (host.match(/:/g) ?? []).length !== 1, {
    message: "a Modbus host is a host name or an IP address, with no port, no slash and no whitespace",
  })
  .transform((host) => host.toLowerCase());

/**
 * The connection slice (decision 5). Strict: the host removes `pollIntervalMs`
 * before this schema sees it (plan C7), so an interval here is a host bug.
 */
export const modbusConfigSchema = z
  .object({
    host: modbusHostSchema,
    port: z.number().int().min(1).max(65_535).default(502),
    /** One request's deadline. */
    timeoutMs: z.number().int().min(100).max(30_000).default(1000),
    /** Pause between two requests on one socket, for slow serial gateways. */
    interRequestDelayMs: z.number().int().min(0).max(5_000).default(0),
  })
  .strict();

export type ModbusConfig = z.infer<typeof modbusConfigSchema>;

/** 0–247, or 255 (Amendment 1 (a)). 248–254 are reserved. */
export const modbusUnitIdSchema = z
  .number()
  .int()
  .min(0)
  .max(MODBUS_UNIT_ID_DIRECT)
  .refine((unitId) => unitId <= MODBUS_UNIT_ID_MAX_SERIAL || unitId === MODBUS_UNIT_ID_DIRECT, {
    message: "a Modbus unit id is 0 to 247, or 255 for a device addressed directly over TCP",
  });

/** A profile code: the `bms.device_profiles.code` CHECK class, at most 64. The profiles API's bodies use it too. */
export const deviceProfileCodeSchema = z.string().min(1).max(64).regex(CATALOG_CODE_PATTERN);

/** Provenance only: the profile a device's registers were copied from (decision 15). */
export const modbusProfileReferenceSchema = z
  .object({ code: deviceProfileCodeSchema, version: z.number().int().min(1) })
  .strict();

/**
 * The device slice (decision 6). `registers` is always the full, resolved
 * list, so the adapter never looks a profile up.
 */
export const modbusDeviceSchema = z
  .object({
    unitId: modbusUnitIdSchema,
    profile: modbusProfileReferenceSchema.optional(),
    registers: modbusRegistersSchema,
  })
  .strict();

export type ModbusDevice = z.infer<typeof modbusDeviceSchema>;

/**
 * What onboarding stores for a Modbus RTU before it is bound to a profile:
 * the connection, an optional endpoint interval, and a device whose
 * `registers` may still be absent. Every present field is checked with the
 * ingest schema's own field.
 */
export const modbusDraftConfigSchema = z
  .object({
    host: modbusHostSchema,
    port: modbusConfigSchema.shape.port.optional(),
    timeoutMs: modbusConfigSchema.shape.timeoutMs.optional(),
    interRequestDelayMs: modbusConfigSchema.shape.interRequestDelayMs.optional(),
    pollIntervalMs: pollIntervalMsSchema.optional(),
    device: z
      .object({
        unitId: modbusUnitIdSchema,
        profile: modbusProfileReferenceSchema.optional(),
        registers: modbusRegistersSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ModbusDraftConfig = z.infer<typeof modbusDraftConfigSchema>;

const sourceTextSchema = z.string().trim().min(1).max(256);

/**
 * A device profile (decision 12): what a stock JSON file holds and what a
 * `bms.device_profiles` row carries beside its organization. `source` cites
 * the public manual the registers were read from.
 */
export const deviceProfileSchema = z
  .object({
    code: deviceProfileCodeSchema,
    version: z.number().int().min(1),
    vendor: z.string().trim().min(1).max(128),
    model: z.string().trim().min(1).max(128),
    source: z
      .object({ document: sourceTextSchema, revision: sourceTextSchema, pages: sourceTextSchema })
      .strict(),
    verified: z.boolean(),
    registers: modbusRegistersSchema,
  })
  .strict();

export type DeviceProfile = z.infer<typeof deviceProfileSchema>;
