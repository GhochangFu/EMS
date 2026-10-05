import {
  workOrderListItemSchema,
  workOrdersListResponseSchema,
} from "@bms/shared/contracts";
import type {
  WorkOrderListItem,
  WorkOrderPriority,
  WorkOrderStatus,
} from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type WorkOrdersListResponse = {
  items: WorkOrderListItem[];
};

export type CreateWorkOrderInput = {
  assetId: string;
  alarmId?: string;
  title: string;
  description?: string;
  priority: WorkOrderPriority;
};

export type UpdateWorkOrderStatusInput = {
  id: string;
  status: WorkOrderStatus;
  reason?: string;
  sortOrder?: number;
};

export type ReorderWorkOrderItem = {
  id: string;
  status: WorkOrderStatus;
  sortOrder: number;
};

/** GET /api/v1/work-orders */
export async function fetchWorkOrders(
  limit = 100,
): Promise<WorkOrdersListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/work-orders?${params}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`work-orders ${res.status}`);
  }
  return checkResponse(workOrdersListResponseSchema, await res.json(), "work-orders");
}

/** POST /api/v1/work-orders */
export async function createWorkOrder(
  input: CreateWorkOrderInput,
): Promise<WorkOrderListItem> {
  const sent = {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  };
  const res = await fetch(`${base}/api/v1/work-orders`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new Error(text || `work-order-create ${res.status}`);
  }
  return checkResponse(workOrderListItemSchema, await res.json(), "work-orders");
}

/** PATCH /api/v1/work-orders/:id/status */
export async function updateWorkOrderStatus(
  input: UpdateWorkOrderStatusInput,
): Promise<WorkOrderListItem> {
  const { id, ...body } = input;
  const sent = {
    ...withAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  };
  const res = await fetch(`${base}/api/v1/work-orders/${id}/status`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new Error(text || `work-order-status ${res.status}`);
  }
  return checkResponse(workOrderListItemSchema, await res.json(), "work-orders/:id/status");
}

/** PATCH /api/v1/work-orders/reorder */
export async function reorderWorkOrders(
  items: ReorderWorkOrderItem[],
): Promise<WorkOrdersListResponse> {
  const sent = {
    ...withAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        reason: "Kanban order updated by drag-and-drop",
      }),
    }),
  };
  const res = await fetch(`${base}/api/v1/work-orders/reorder`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new Error(text || `work-order-reorder ${res.status}`);
  }
  return checkResponse(workOrdersListResponseSchema, await res.json(), "work-orders/reorder");
}

/** POST /api/v1/work-orders/:id/close */
export async function closeWorkOrder(
  id: string,
  reason: string,
  sortOrder?: number,
): Promise<WorkOrderListItem> {
  const sent = {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, sortOrder }),
    }),
  };
  const res = await fetch(`${base}/api/v1/work-orders/${id}/close`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new Error(text || `work-order-close ${res.status}`);
  }
  return checkResponse(workOrderListItemSchema, await res.json(), "work-orders/:id/close");
}
