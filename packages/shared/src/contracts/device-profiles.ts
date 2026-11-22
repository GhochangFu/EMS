import { z } from "zod";

import { CATALOG_CODE_PATTERN } from "../constants";
import { deviceProfileSchema, modbusRegistersSchema } from "../ingest-modbus";

/**
 * `F1.2` (ADR 0141 decisions 12–14, plan T5.1, builder call C12) — the device
 * profiles API: `/admin/device-profiles`.
 *
 * Plain `z.object` throughout: bodies `.strict()`, responses not strict, no
 * `.merge()`, no `z.intersection`, no `.readonly()`. The register list is
 * `modbusRegistersSchema` **by reference** (1 to 256 entries, unique
 * `sourceKey`), so a body and a stock file are checked by one schema and a
 * later change to the register shape reaches both.
 *
 * A body never carries `version`, `verified`, `createdBy` or `stockCode`: the
 * server sets them (plan P2 — every save is a new row at `max(version) + 1`,
 * an edit or a copy is `verified: false`, only an import copies a stock
 * file's `verified`). `.strict()` makes any of them a 400 rather than a key
 * dropped and answered 201.
 */

/** A profile code: the `bms.device_profiles.code` CHECK (`^[A-Za-z0-9_-]+$`), at most 64. */
export const deviceProfileCodeSchema = z.string().min(1).max(64).regex(CATALOG_CODE_PATTERN);

/** The manual a profile's registers were read from, as stored (response side, not strict). */
const deviceProfileSourceDtoSchema = z.object({
  document: z.string(),
  revision: z.string(),
  pages: z.string(),
});

/** One `bms.device_profiles` row. */
export const deviceProfileDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  protocol: z.literal("modbus_tcp"),
  code: z.string(),
  version: z.number().int().min(1),
  vendor: z.string(),
  model: z.string(),
  source: deviceProfileSourceDtoSchema,
  verified: z.boolean(),
  registers: modbusRegistersSchema,
  /** The stock file this row was imported from; both or neither. */
  stockCode: z.string().nullable(),
  stockVersion: z.number().int().min(1).nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
});

/** Every version of every profile of one organization, by code then version (newest first). */
export const deviceProfileListSchema = z.array(deviceProfileDtoSchema);

/** One stock profile as the repository ships it (decision 14). */
export const stockDeviceProfileDtoSchema = z.object({
  code: z.string(),
  version: z.number().int().min(1),
  vendor: z.string(),
  model: z.string(),
  source: deviceProfileSourceDtoSchema,
  verified: z.boolean(),
  registers: modbusRegistersSchema,
});

/** The stock list. */
export const stockDeviceProfileListSchema = z.array(stockDeviceProfileDtoSchema);

/** `POST /admin/device-profiles` — a new profile at version 1, `verified: false`. */
export const createDeviceProfileBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    code: deviceProfileCodeSchema,
    vendor: deviceProfileSchema.shape.vendor,
    model: deviceProfileSchema.shape.model,
    source: deviceProfileSchema.shape.source,
    registers: modbusRegistersSchema,
  })
  .strict();

/**
 * `POST /admin/device-profiles/:id/versions` — the next version of `:id`'s
 * code. `baseVersion` is the version the editor was opened on: a save whose
 * base is not the newest version is a 409, so a second save from the same
 * base never lands silently on top of the first.
 */
export const saveDeviceProfileVersionBodySchema = z
  .object({
    baseVersion: z.number().int().min(1),
    vendor: deviceProfileSchema.shape.vendor,
    model: deviceProfileSchema.shape.model,
    source: deviceProfileSchema.shape.source,
    registers: modbusRegistersSchema,
  })
  .strict();

/** `POST /admin/device-profiles/:id/copy` — `:id`'s row under a new code, version 1, in the same organization. */
export const copyDeviceProfileBodySchema = z.object({ code: deviceProfileCodeSchema }).strict();

/** `POST /admin/device-profiles/stock/:code/import` — the organization the copy lands in. */
export const importStockDeviceProfileBodySchema = z.object({ organizationId: z.string().uuid() }).strict();

/** `GET /admin/device-profiles?organizationId=` — the organization listed. */
export const listDeviceProfilesQuerySchema = z.object({ organizationId: z.string().uuid() }).strict();

// Exported from here, not `src/index.ts`, which sits at the 1000-line cap (C12).
export type DeviceProfileDto = z.infer<typeof deviceProfileDtoSchema>;
export type DeviceProfileList = z.infer<typeof deviceProfileListSchema>;
export type StockDeviceProfileDto = z.infer<typeof stockDeviceProfileDtoSchema>;
export type StockDeviceProfileList = z.infer<typeof stockDeviceProfileListSchema>;
export type CreateDeviceProfileBody = z.infer<typeof createDeviceProfileBodySchema>;
export type SaveDeviceProfileVersionBody = z.infer<typeof saveDeviceProfileVersionBodySchema>;
export type CopyDeviceProfileBody = z.infer<typeof copyDeviceProfileBodySchema>;
export type ImportStockDeviceProfileBody = z.infer<typeof importStockDeviceProfileBodySchema>;
export type ListDeviceProfilesQuery = z.infer<typeof listDeviceProfilesQuerySchema>;
