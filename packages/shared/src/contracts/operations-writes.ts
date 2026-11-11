import { z } from "zod";

import { alarmSkillCodeSchema, assetDomainCodeSchema, workOrderPrioritySchema, workOrderStatusSchema } from "./operations";
import { WORK_ORDER_SLA_MAX_MINUTES } from "../work-order-sla";
import { workOrderTaskResultSchema } from "./work-orders";

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
 * The copilot's enrichment body. Owner ruling DC4 (2026-10-24) left `skillCode`
 * out; the owner ruling of 2026-10-25 (Q4) puts it back — `list_alarm_skills`
 * lists the active codes, and the resolver refuses an unknown one before the
 * card. The route still parses {@link alarmEnrichmentUpsertBodySchema}.
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
    skillCode: alarmSkillCodeSchema.nullable().optional(),
    affectedAssetIds: enrichmentAffected,
  })
  .strict();

const workOrderReason = z.string().min(3).max(2000);
const workOrderSortOrder = z.number().int().min(0).max(100_000);

/** `E3.1` (ADR 0122 decision 3): an SLA in whole minutes, one minute to one year. */
export const workOrderSlaMinutesSchema = z.number().int().min(1).max(WORK_ORDER_SLA_MAX_MINUTES);

export const createWorkOrderBodySchema = z
  .object({
    assetId: z.string().uuid(),
    alarmId: z.string().uuid().optional(),
    title: z.string().min(3).max(255),
    description: z.string().max(4000).optional(),
    priority: workOrderPrioritySchema.default("medium"),
    assignedTo: z.string().uuid().optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
    /**
     * `E3.1` (ADR 0122 decision 3.2): wins over the organization's policy for this one
     * ticket. Administrators only (owner ruling, 2026-11-11): the route refuses an
     * `operator` who sends it.
     */
    slaMinutes: workOrderSlaMinutesSchema.optional(),
    /** `E3.1` (ADR 0122 decision 4.3): the checklist template whose items are copied onto the ticket. */
    checklistTemplateId: z.string().uuid().optional(),
  })
  .strict();

const checklistItemTitle = z.string().min(2).max(255);

/** `POST /work-orders/:id/tasks` (`E3.1`, ADR 0122 decision 4.3): one checklist item added by hand. */
export const createWorkOrderTaskBodySchema = z
  .object({
    title: checklistItemTitle,
    mandatory: z.boolean().default(false),
  })
  .strict();

/**
 * `PATCH /work-orders/:id/tasks/:taskId` (`E3.1`, ADR 0122 decision 4): the item's
 * result, its note, or both. `note: null` clears the note.
 */
export const updateWorkOrderTaskBodySchema = z
  .object({
    result: workOrderTaskResultSchema.optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((body) => body.result !== undefined || body.note !== undefined, {
    message: "Send a result, a note, or both",
  })
  .describe("At least one of result and note must be sent.");

/** One line of a checklist template, as it is written (`E3.1`, ADR 0122 decision 4.2). */
export const workOrderChecklistTemplateItemInputSchema = z
  .object({
    title: checklistItemTitle,
    mandatory: z.boolean().default(false),
  })
  .strict();

const checklistTemplateName = z.string().min(3).max(255);
/** An asset domain code, or null for a template that fits every domain. The route checks the code exists. */
const checklistTemplateDomain = assetDomainCodeSchema.nullable();
/** The order of the array is the order of the checklist. */
const checklistTemplateItems = z.array(workOrderChecklistTemplateItemInputSchema).min(1).max(100);

/** `POST /admin/work-order-checklist-templates`. */
export const createWorkOrderChecklistTemplateBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    name: checklistTemplateName,
    domain: checklistTemplateDomain.optional(),
    items: checklistTemplateItems,
  })
  .strict();

/**
 * `PATCH /admin/work-order-checklist-templates/:id`. `items`, when sent, REPLACES the
 * template's whole list; a ticket that already copied the old items keeps them
 * (decision 4.3). `active: false` retires the template.
 */
export const updateWorkOrderChecklistTemplateBodySchema = z
  .object({
    name: checklistTemplateName.optional(),
    domain: checklistTemplateDomain.optional(),
    active: z.boolean().optional(),
    items: checklistTemplateItems.optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one field to change",
  })
  .describe("At least one of name, domain, active and items must be sent.");

/** One row of `PUT /admin/work-order-sla-policies` (`E3.1`, ADR 0122 decision 3.2). */
export const workOrderSlaPolicyInputSchema = z
  .object({
    priority: workOrderPrioritySchema,
    resolutionMinutes: workOrderSlaMinutesSchema,
  })
  .strict();

/**
 * `PUT /admin/work-order-sla-policies` — replaces the organization's whole set (plan D8):
 * a priority left out goes back to the platform default. At most one row per priority.
 */
export const putWorkOrderSlaPoliciesBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    policies: z
      .array(workOrderSlaPolicyInputSchema)
      .max(4)
      .refine((rows) => new Set(rows.map((row) => row.priority)).size === rows.length, {
        message: "Each priority may appear once",
      })
      .describe("At most one row per priority; a priority left out goes back to the platform default."),
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
export type PutWorkOrderSlaPoliciesBody = z.infer<typeof putWorkOrderSlaPoliciesBodySchema>;
export type CreateWorkOrderTaskBody = z.infer<typeof createWorkOrderTaskBodySchema>;
export type UpdateWorkOrderTaskBody = z.infer<typeof updateWorkOrderTaskBodySchema>;
export type CreateWorkOrderChecklistTemplateBody = z.infer<typeof createWorkOrderChecklistTemplateBodySchema>;
export type UpdateWorkOrderChecklistTemplateBody = z.infer<typeof updateWorkOrderChecklistTemplateBodySchema>;
/** What a caller sends: the defaulted `priority` may be left out. */
export type CreateWorkOrderInput = z.input<typeof createWorkOrderBodySchema>;
export type UpdateWorkOrderStatusBody = z.infer<typeof updateWorkOrderStatusBodySchema>;
export type CloseWorkOrderBody = z.infer<typeof closeWorkOrderBodySchema>;
export type ReorderWorkOrdersBody = z.infer<typeof reorderWorkOrdersBodySchema>;
