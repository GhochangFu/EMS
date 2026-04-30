import type {
  WorkOrderListItem,
  WorkOrderPriority,
  WorkOrderStatus,
} from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";

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
  const res = await fetch(`${base}/api/v1/work-orders?${params}`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`work-orders ${res.status}`);
  }
  return res.json() as Promise<WorkOrdersListResponse>;
}

/** POST /api/v1/work-orders */
export async function createWorkOrder(
  input: CreateWorkOrderInput,
): Promise<WorkOrderListItem> {
  const res = await fetch(`${base}/api/v1/work-orders`, {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `work-order-create ${res.status}`);
  }
  return res.json() as Promise<WorkOrderListItem>;
}

/** PATCH /api/v1/work-orders/:id/status */
export async function updateWorkOrderStatus(
  input: UpdateWorkOrderStatusInput,
): Promise<WorkOrderListItem> {
  const { id, ...body } = input;
  const res = await fetch(`${base}/api/v1/work-orders/${id}/status`, {
    ...withAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `work-order-status ${res.status}`);
  }
  return res.json() as Promise<WorkOrderListItem>;
}

/** PATCH /api/v1/work-orders/reorder */
export async function reorderWorkOrders(
  items: ReorderWorkOrderItem[],
): Promise<WorkOrdersListResponse> {
  const res = await fetch(`${base}/api/v1/work-orders/reorder`, {
    ...withAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        reason: "Kanban order updated by drag-and-drop",
      }),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `work-order-reorder ${res.status}`);
  }
  return res.json() as Promise<WorkOrdersListResponse>;
}

/** POST /api/v1/work-orders/:id/close */
export async function closeWorkOrder(
  id: string,
  reason: string,
  sortOrder?: number,
): Promise<WorkOrderListItem> {
  const res = await fetch(`${base}/api/v1/work-orders/${id}/close`, {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, sortOrder }),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `work-order-close ${res.status}`);
  }
  return res.json() as Promise<WorkOrderListItem>;
}
