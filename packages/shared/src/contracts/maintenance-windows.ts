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

/** The three target kinds: the union's discriminator and the list item's `kind`, from this one list. */
export const maintenanceWindowTargetKindSchema = z.enum(["asset", "location", "rule"]);
const TARGET_KIND = maintenanceWindowTargetKindSchema.enum;

export const maintenanceWindowTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(TARGET_KIND.asset), assetId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal(TARGET_KIND.location), locationId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal(TARGET_KIND.rule), ruleId: z.string().uuid() }).strict(),
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

/** A target's kind and id, the id lower-cased: two that match name the same target. */
const targetKey = (target: z.infer<typeof maintenanceWindowTargetSchema>): string =>
  `${target.kind}:${(target.kind === "asset" ? target.assetId : target.kind === "location" ? target.locationId : target.ruleId).toLowerCase()}`;

/** ADR 0099 Amendment 19 Q4: a Copilot proposal names at most 25 targets; the route and the page's wizard keep 200. */
export const COPILOT_MAINTENANCE_WINDOW_MAX_TARGETS = 25;

/**
 * `F4.359` PR 6 (ADR 0099 Amendment 19 decision 1, Q4): the body the Copilot proposes a window
 * with — the route's fields, strict, with at most 25 targets, each named once (review of PR 6: the
 * card counts the targets it lists), and `startsAt` described as "omit for now" so a card confirmed
 * after the route's one-minute start grace is not stale. It binds the model only; the
 * Confirm sends it to the route, which parses `createMaintenanceWindowBodySchema`.
 */
export const copilotCreateMaintenanceWindowModelBodySchema = z
  .object({
    reason: reasonSchema,
    startsAt: isoDateTime
      .optional()
      .describe("Omit to start now. Give it only for a later start; one over a minute in the past is refused."),
    endsAt: isoDateTime,
    targets: z
      .array(maintenanceWindowTargetSchema)
      .min(1)
      .max(COPILOT_MAINTENANCE_WINDOW_MAX_TARGETS)
      .refine((targets) => new Set(targets.map(targetKey)).size === targets.length, { message: "each target may be named once" })
      .describe("1 to 25 targets, each named once (kind and id, case-insensitive)."),
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
      kind: maintenanceWindowTargetKindSchema,
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
