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
export type WorkOrderEventType = z.infer<typeof Wo.workOrderEventTypeSchema>;
export type WorkOrderOrigin = z.infer<typeof Wo.workOrderOriginSchema>;
export type WorkOrderEventDetail = z.infer<typeof Wo.workOrderEventDetailSchema>;
export type WorkOrderEventDto = z.infer<typeof Wo.workOrderEventDtoSchema>;
export type WorkOrderAlarmSummary = z.infer<typeof Wo.workOrderAlarmSummarySchema>;
export type WorkOrderDetail = z.infer<typeof Wo.workOrderDetailSchema>;
export type WorkOrderTaskResult = z.infer<typeof Wo.workOrderTaskResultSchema>;
export type WorkOrderTaskDto = z.infer<typeof Wo.workOrderTaskDtoSchema>;
export type WorkOrderChecklistTemplateItemDto = z.infer<typeof Wo.workOrderChecklistTemplateItemDtoSchema>;
export type WorkOrderChecklistTemplateDto = z.infer<typeof Wo.workOrderChecklistTemplateDtoSchema>;
export type WorkOrderChecklistTemplatesResponse = z.infer<typeof Wo.workOrderChecklistTemplatesResponseSchema>;
