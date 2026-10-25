import type { WorkOrderPriority, WorkOrderStatus } from "@bms/shared";

/** `F4.284`: the work-order vocabularies as the board and its wizards show them (moved from `work-orders-page.tsx`). */
export const statusLabels: Record<WorkOrderStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const priorityLabels: Record<WorkOrderPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const priorities: WorkOrderPriority[] = ["low", "medium", "high", "critical"];

/** ADR 0106 decision 2: a status change never closes — the close has its own wizard and a reason. */
export const settableStatuses: WorkOrderStatus[] = ["open", "assigned", "in_progress", "resolved"];
