import type { SettableWorkOrderStatus, WorkOrderPriority, WorkOrderStatus } from "@bms/shared";

/** `F4.284`: the work-order vocabularies as the board and its wizards show them (moved from `work-orders-page.tsx`). */
export const statusLabels: Record<WorkOrderStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
  cancelled: "Cancelled",
};

/** `E3.1` (ADR 0122 decision 6.2): the Close action is the approval of a resolved ticket. */
export const APPROVE_AND_CLOSE_LABEL = "Approve and close";

export const priorityLabels: Record<WorkOrderPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const priorities: WorkOrderPriority[] = ["low", "medium", "high", "critical"];

/**
 * ADR 0106 decision 2 and ADR 0122 decision 6.5: a status change never closes and never
 * cancels — the approval has its own wizard and a reason, and so does the cancel.
 */
export const settableStatuses: SettableWorkOrderStatus[] = ["open", "assigned", "in_progress", "resolved"];
