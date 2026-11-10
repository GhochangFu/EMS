/**
 * `E3.1` / ADR 0122 — the work-order response types, each `z.infer`red from its schema
 * (ADR 0030 decision 2). Re-exported by `index.ts`, which sits at the AGENTS.md
 * section 4.5 cap (plan D5): the four work-order types that used to be declared there
 * moved here.
 */
import type { z } from "zod";

import type * as E from "../contracts/envelopes";
import type * as Op from "../contracts/operations";
import type * as Wo from "../contracts/work-orders";

export type WorkOrderStatus = z.infer<typeof Op.workOrderStatusSchema>;
export type WorkOrderPriority = z.infer<typeof Op.workOrderPrioritySchema>;
/** One work order row for Phase 5 Sprint A API responses. */
export type WorkOrderListItem = z.infer<typeof Op.workOrderListItemSchema>;
export type WorkOrdersListResponse = z.infer<typeof E.workOrdersListResponseSchema>;
export type WorkOrderSlaState = z.infer<typeof Op.workOrderSlaStateSchema>;
export type WorkOrderSlaPolicyDto = z.infer<typeof Wo.workOrderSlaPolicyDtoSchema>;
export type WorkOrderSlaPoliciesResponse = z.infer<typeof Wo.workOrderSlaPoliciesResponseSchema>;
