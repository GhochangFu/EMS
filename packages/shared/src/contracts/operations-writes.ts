import { z } from "zod";

import { alarmSkillCodeSchema, workOrderPrioritySchema, workOrderStatusSchema } from "./operations";

/**
 * `F4.284` (ADR 0106 decision 7, ADR 0030) — the request bodies of the alarm
 * write routes (`apps/api/src/alarms/alarms.controller.ts`) and the work-order
 * write routes (`apps/api/src/work-orders/work-orders.controller.ts`), moved
 * here from `apps/api` so the copilot catalog entries carry the route's own
 * body by identity. The API schema files re-export them under their old names.
 *
 * Plain `z.object`s (the `maintenance-writes.ts` pattern): no `.merge()`, no
 * `.omit().extend()` — `tests/adr-0030-contract-derivation.test.ts` scans for
 * both — no `z.intersection`, since nothing here is composed, and no
 * `.readonly()`, since nothing here is all-readonly. Every route body is
 * `.strict()` and carries a ledger entry in `apps/api/src/testing/strict-body-ledger.data.ts`.
 */

/** `POST /alarms/:id/ack`: the reason the audit row records. The copilot's hash binds it (ADR 0106 decision 3). */
export const alarmAckBodySchema = z
  .object({
    reason: z.string().min(3).max(2000),
  })
  .strict();

const enrichmentText = z.string().max(2000).nullable().optional();
/** No future-only refinement — revising a passed ETR is legitimate. */
const enrichmentEtr = z.string().datetime({ offset: true }).nullable().optional();
const enrichmentAffected = z.array(z.string().uuid()).max(50).optional();

/** `PUT /alarms/:id/enrichment` (ADR 0034 decision 6). */
export const alarmEnrichmentUpsertBodySchema = z
  .object({
    rootCause: enrichmentText,
    impact: enrichmentText,
    correctiveActions: enrichmentText,
    energyImpact: enrichmentText,
    waterImpact: enrichmentText,
    productionImpact: enrichmentText,
    etrAt: enrichmentEtr,
    skillCode: alarmSkillCodeSchema.nullable().optional(),
    affectedAssetIds: enrichmentAffected,
  })
  .strict();

/**
 * Owner ruling DC4 (2026-10-24): the copilot's enrichment body leaves out
 * `skillCode` — no read tool lists the alarm skills, so the page sets it. The
 * route still parses {@link alarmEnrichmentUpsertBodySchema}.
 */
export const copilotAlarmEnrichmentModelBodySchema = z
  .object({
    rootCause: enrichmentText,
    impact: enrichmentText,
    correctiveActions: enrichmentText,
    energyImpact: enrichmentText,
    waterImpact: enrichmentText,
    productionImpact: enrichmentText,
    etrAt: enrichmentEtr,
    affectedAssetIds: enrichmentAffected,
  })
  .strict();

const workOrderReason = z.string().min(3).max(2000);
const workOrderSortOrder = z.number().int().min(0).max(100_000);

export const createWorkOrderBodySchema = z
  .object({
    assetId: z.string().uuid(),
    alarmId: z.string().uuid().optional(),
    title: z.string().min(3).max(255),
    description: z.string().max(4000).optional(),
    priority: workOrderPrioritySchema.default("medium"),
    assignedTo: z.string().uuid().optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const updateWorkOrderStatusBodySchema = z
  .object({
    status: workOrderStatusSchema,
    reason: workOrderReason.optional(),
    sortOrder: workOrderSortOrder.optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .strict();

/**
 * ADR 0106 decision 2: the copilot's status body leaves out `closed`, so a close
 * always goes through `POST /work-orders/:id/close` and carries a reason. The
 * route still parses {@link updateWorkOrderStatusBodySchema}.
 */
export const copilotWorkOrderSetStatusModelBodySchema = z
  .object({
    status: z.enum(["open", "assigned", "in_progress", "resolved"]),
    reason: workOrderReason.optional(),
    sortOrder: workOrderSortOrder.optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .strict();

export const closeWorkOrderBodySchema = z
  .object({
    reason: workOrderReason,
    sortOrder: workOrderSortOrder.optional(),
  })
  .strict();

export const reorderWorkOrdersBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            status: workOrderStatusSchema,
            sortOrder: workOrderSortOrder,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    reason: workOrderReason.optional(),
  })
  .strict();

export type AlarmAckBody = z.infer<typeof alarmAckBodySchema>;
export type AlarmEnrichmentUpsertBody = z.infer<typeof alarmEnrichmentUpsertBodySchema>;
export type CreateWorkOrderBody = z.infer<typeof createWorkOrderBodySchema>;
/** What a caller sends: the defaulted `priority` may be left out. */
export type CreateWorkOrderInput = z.input<typeof createWorkOrderBodySchema>;
export type UpdateWorkOrderStatusBody = z.infer<typeof updateWorkOrderStatusBodySchema>;
export type CloseWorkOrderBody = z.infer<typeof closeWorkOrderBodySchema>;
export type ReorderWorkOrdersBody = z.infer<typeof reorderWorkOrdersBodySchema>;
