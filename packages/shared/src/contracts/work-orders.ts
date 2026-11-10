/**
 * `E3.1` (ADR 0122) — the work-order response schemas added by work-order depth. A new
 * file because `operations.ts` is near the AGENTS.md section 4.5 cap (plan D5); the
 * request bodies stay in `operations-writes.ts`.
 */
import { z } from "zod";

import { workOrderPrioritySchema } from "./operations";

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
