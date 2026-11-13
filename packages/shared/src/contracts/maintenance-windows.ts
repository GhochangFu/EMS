import { z } from "zod";

/**
 * `F4.359` / ADR 0131 — the maintenance-window contracts (create, extend,
 * close and the list response).
 *
 * Every response schema is one plain `z.object` (ADR 0030): no `.merge()`,
 * `.extend()`, intersection or `.readonly()`. The target is a
 * `discriminatedUnion`, never a flattened object with three optional ids. The
 * types are exported from this file, not `src/index.ts`, which sits at the
 * §4.5 cap (the `edge-gateways.ts` precedent).
 */

/** A window may run at most 7 days (ADR 0131). */
export const MAINTENANCE_WINDOW_MAX_MS = 7 * 24 * 60 * 60 * 1000;

const isoDateTime = z.string().datetime({ offset: true });

/**
 * The reason, trimmed, 3-2000 characters counted in code points: the database
 * CHECK uses Postgres `char_length` (code points), and `.length` counts UTF-16
 * units, so an emoji-heavy reason could pass one and fail the other.
 */
const reasonSchema = z
  .string()
  .trim()
  .refine((s) => [...s].length >= 3, { message: "reason must be at least 3 characters" })
  .describe("At least 3 characters after trimming, counted in code points.")
  .refine((s) => [...s].length <= 2000, { message: "reason must be at most 2000 characters" })
  .describe("3 to 2000 characters after trimming, counted in code points (the database CHECK's char_length).");

export const maintenanceWindowTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset"), assetId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("location"), locationId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("rule"), ruleId: z.string().uuid() }).strict(),
]);

export const createMaintenanceWindowBodySchema = z
  .object({
    reason: reasonSchema,
    /** Absent = now. */
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime,
    targets: z.array(maintenanceWindowTargetSchema).min(1).max(200),
    workOrderId: z.string().uuid().optional(),
    maintenanceScheduleId: z.string().uuid().optional(),
  })
  .strict();

export const extendMaintenanceWindowBodySchema = z
  .object({ endsAt: isoDateTime, reason: reasonSchema.optional() })
  .strict();

/** End (active) or cancel (future) a window. */
export const closeMaintenanceWindowBodySchema = z.object({ reason: reasonSchema.optional() }).strict();

export const maintenanceWindowStateSchema = z.enum(["active", "future", "past"]);

export const maintenanceWindowItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  reason: z.string(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  endedAt: isoDateTime.nullable(),
  state: maintenanceWindowStateSchema,
  createdByName: z.string(),
  endedByName: z.string().nullable(),
  workOrder: z.object({ id: z.string().uuid(), reference: z.string() }).nullable(),
  maintenanceSchedule: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  targets: z.array(
    z.object({
      kind: z.enum(["asset", "location", "rule"]),
      id: z.string().uuid(),
      label: z.string(),
    }),
  ),
  /** D16: the resolved asset ids the window covers. */
  assetIds: z.array(z.string().uuid()),
});

export const maintenanceWindowsResponseSchema = z.object({
  items: z.array(maintenanceWindowItemSchema),
});

export type MaintenanceWindowTarget = z.infer<typeof maintenanceWindowTargetSchema>;
export type CreateMaintenanceWindowBody = z.infer<typeof createMaintenanceWindowBodySchema>;
export type ExtendMaintenanceWindowBody = z.infer<typeof extendMaintenanceWindowBodySchema>;
export type CloseMaintenanceWindowBody = z.infer<typeof closeMaintenanceWindowBodySchema>;
export type MaintenanceWindowState = z.infer<typeof maintenanceWindowStateSchema>;
export type MaintenanceWindowItem = z.infer<typeof maintenanceWindowItemSchema>;
export type MaintenanceWindowsResponse = z.infer<typeof maintenanceWindowsResponseSchema>;
