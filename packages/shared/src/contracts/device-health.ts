import { z } from "zod";

import { DROP_REASONS } from "../device-health";

/**
 * `F3.16` / ADR 0127 decisions 7, 8, 17 and 19 — the device-health read
 * contracts (`GET /api/v1/admin/rtus/health`, the per-RTU drop history).
 *
 * Plain `z.object` throughout: nothing here is an intersection or all-readonly,
 * so no `z.intersection` or `.readonly()` applies, and a later change must not
 * use `.merge()` (ADR 0030). The types are exported from this file, not from
 * `src/index.ts`, which sits at the §4.5 cap (the `edge-gateways.ts`
 * precedent); `contracts/index.ts` re-exports them and the root re-exports that.
 *
 * Device-supplied strings (`sourceKey`, `pointKey`) are cut and stripped by the
 * writer (decision 8) and rendered as text by the web.
 */

// The zod-free vocabulary, re-exported so the package barrel (`src/index.ts`, at
// the §4.5 cap) reaches it through `export * from "./contracts"`. `apps/ingest`
// imports `../device-health` directly and never pulls zod.
export * from "../device-health";

export const dropReasonSchema = z.enum(DROP_REASONS);

/** `not_monitored`: the RTU has no ingest binding (a simulator or catalog RTU, decision 20). */
export const rtuHealthStateSchema = z.enum(["online", "stale", "offline", "not_monitored"]);

/** The first dropped sample of a bucket or day: which point, or which source key when no point exists. */
export const dropFirstSchema = z.object({
  assetId: z.string().nullable(),
  assetCode: z.string().nullable(),
  /** ADR 0111: a schema that names an asset code names its RTU and location, for `assetLabel`. */
  assetRtuName: z.string().nullable(),
  assetLocationName: z.string().nullable(),
  pointKey: z.string().nullable(),
  sourceKey: z.string().nullable(),
});

export const rtuDropCountSchema = z.object({
  reason: dropReasonSchema,
  count: z.number().int().positive(),
  first: dropFirstSchema.nullable(),
});

export const rtuHealthDtoSchema = z.object({
  rtuId: z.string(),
  state: rtuHealthStateSchema,
  lastSeenAt: z.string().nullable(),
  /** The RTU's offline window in seconds (`clamp(2.5 x interval, 25 s, 900 s)`). */
  windowSeconds: z.number().int().positive(),
  /** `device_time - receive time` of the newest sample with a device time; positive when the device is ahead. */
  clockSkewSeconds: z.number().int().nullable(),
  clockSkewAt: z.string().nullable(),
  /** Behind an edge gateway (ADR 0123): last-seen lags by design and raises no comms-loss alarm (decision 18). */
  edgeServed: z.boolean(),
  drops24h: z.array(rtuDropCountSchema),
});

export const ingestHostStateSchema = z.enum(["ok", "stale", "never"]);

export const ingestHostSchema = z.object({
  state: ingestHostStateSchema,
  lastBeatAt: z.string().nullable(),
});

/** A drop with no RTU, per ingest host and endpoint (decision 17). Global admin only. */
export const unattributedDropSchema = z.object({
  hostKey: z.string(),
  endpointKey: z.string(),
  reason: dropReasonSchema,
  count: z.number().int().positive(),
  firstDeviceKey: z.string().nullable(),
  firstSourceKey: z.string().nullable(),
});

export const deviceHealthResponseSchema = z.object({
  ingestHost: ingestHostSchema,
  items: z.array(rtuHealthDtoSchema),
  /** Empty unless the caller is a global admin (decision 17). */
  unattributed: z.array(unattributedDropSchema),
});

export const rtuDropHistoryItemSchema = z.object({
  bucket: z.string(),
  reason: dropReasonSchema,
  count: z.number().int().positive(),
  first: dropFirstSchema.nullable(),
});

export const rtuDropHistoryResponseSchema = z.object({
  items: z.array(rtuDropHistoryItemSchema),
});

export type RtuHealthState = z.infer<typeof rtuHealthStateSchema>;
export type DropFirst = z.infer<typeof dropFirstSchema>;
export type RtuDropCount = z.infer<typeof rtuDropCountSchema>;
export type RtuHealthDto = z.infer<typeof rtuHealthDtoSchema>;
export type IngestHostState = z.infer<typeof ingestHostStateSchema>;
export type IngestHost = z.infer<typeof ingestHostSchema>;
export type UnattributedDrop = z.infer<typeof unattributedDropSchema>;
export type DeviceHealthResponse = z.infer<typeof deviceHealthResponseSchema>;
export type RtuDropHistoryItem = z.infer<typeof rtuDropHistoryItemSchema>;
export type RtuDropHistoryResponse = z.infer<typeof rtuDropHistoryResponseSchema>;
