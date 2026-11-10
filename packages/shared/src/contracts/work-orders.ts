/**
 * `E3.1` (ADR 0122) — the work-order response schemas added by work-order depth. A new
 * file because `operations.ts` is near the AGENTS.md section 4.5 cap (plan D5); the
 * request bodies stay in `operations-writes.ts`.
 */
import { z } from "zod";

import { workOrderListItemSchema, workOrderPrioritySchema, workOrderStatusSchema } from "./operations";

/**
 * A work-order reference prefix (`ELEC`, `STP`): two to eight upper-case letters or
 * digits. The same rule is a `CHECK` on `bms.asset_domains.work_order_prefix` and on
 * `bms.asset_templates.work_order_prefix` (migration `0140`).
 */
export const WORK_ORDER_PREFIX_PATTERN = /^[A-Z0-9]{2,8}$/;
export const workOrderPrefixSchema = z.string().regex(WORK_ORDER_PREFIX_PATTERN);

/** The prefix of a ticket whose asset has neither a template prefix nor a domain prefix. */
export const WORK_ORDER_FALLBACK_PREFIX = "GEN";

/**
 * One row of `GET /admin/work-order-sla-policies`. The read always answers all four
 * priorities; `source` says whether the minutes are the organization's own row or the
 * platform default (plan D8).
 */
export const workOrderSlaPolicyDtoSchema = z.object({
  priority: workOrderPrioritySchema,
  resolutionMinutes: z.number().int(),
  source: z.enum(["organization", "default"]),
});

/** `GET` and `PUT /admin/work-order-sla-policies`. */
export const workOrderSlaPoliciesResponseSchema = z.object({
  organizationId: z.string(),
  items: z.array(workOrderSlaPolicyDtoSchema),
});

// ---------------------------------------------------------------------------
// The timeline (ADR 0122 decisions 7 and 8) — `bms.work_order_events`
// ---------------------------------------------------------------------------

/**
 * What can happen to a work order. A closed vocabulary: the same ten values are a
 * `CHECK` on `bms.work_order_events.event_type` (migration `0144`). `sla_changed` is
 * reserved and has no writer yet (plan D21).
 */
export const WORK_ORDER_EVENT_TYPES = [
  "created",
  "assigned",
  "status_changed",
  "task_updated",
  "root_cause_set",
  "resolved",
  "approved",
  "rejected",
  "cancelled",
  "sla_changed",
] as const;
export const workOrderEventTypeSchema = z.enum(WORK_ORDER_EVENT_TYPES);

/** How a ticket came to exist; the stepper's first step reads it (decision 8). */
export const workOrderOriginSchema = z.enum(["alarm", "manual", "schedule"]);

/**
 * An event's `detail` — a CLOSED shape (plan D6). Every key is optional and known, and
 * the object is strict, so nothing else can ride along: in particular no email and no
 * `oidcSubject` (ADR 0046 Amendment 2). The only free text is `reason`, which the user
 * typed. One writer builds it (`apps/api/src/work-orders/work-order-events.ts`).
 */
export const workOrderEventDetailSchema = z
  .object({
    reason: z.string().max(2000).optional(),
    origin: workOrderOriginSchema.optional(),
    taskId: z.string().uuid().optional(),
    result: z.string().max(32).optional(),
    causeCode: z.string().max(64).optional(),
    /** The new assignee's user id; `null` when the ticket was unassigned. */
    assignedTo: z.string().uuid().nullable().optional(),
    selfApproved: z.boolean().optional(),
  })
  .strict();

/**
 * One row of a ticket's timeline. `actorName` is the display name SAVED on the event
 * when it was written (ruling P7) — not a join to `bms.users` — so a tenant reader sees
 * a global admin's name and a later rename does not rewrite history. Null on an event
 * written by an actor with no user row.
 */
export const workOrderEventDtoSchema = z.object({
  id: z.string(),
  eventType: workOrderEventTypeSchema,
  actorName: z.string().nullable(),
  fromStatus: workOrderStatusSchema.nullable(),
  toStatus: workOrderStatusSchema.nullable(),
  detail: workOrderEventDetailSchema,
  createdAt: z.string(),
});

/** The alarm a ticket was raised from, as the detail view names it. */
export const workOrderAlarmSummarySchema = z.object({
  id: z.string(),
  severity: z.string(),
  message: z.string(),
  raisedAt: z.string(),
});

const workOrderDetailExtrasSchema = z.object({
  /** Oldest first: `created_at`, then `id`. Empty for a ticket older than the events table (ruling P10). */
  events: z.array(workOrderEventDtoSchema),
  alarm: workOrderAlarmSummarySchema.nullable(),
});

/**
 * `GET /work-orders/:id` — the list item plus the timeline and the alarm summary.
 *
 * `z.intersection`, on purpose (ADR 0030 Amendment 1 rule 2): never `.merge()` or
 * `.extend()`. A flattened copy would still typecheck and would silently stop following
 * `workOrderListItemSchema` when the item gains a field.
 */
export const workOrderDetailSchema = z.intersection(workOrderListItemSchema, workOrderDetailExtrasSchema);
