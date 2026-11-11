import {
  workOrderCauseCodesResponseSchema,
  workOrderChecklistTemplatesResponseSchema,
  workOrderDetailSchema,
  workOrderListItemSchema,
  workOrdersListResponseSchema,
  workOrderTaskDtoSchema,
} from "@bms/shared/contracts";
import type {
  BoardWorkOrderStatus,
  CreateWorkOrderInput as SharedCreateWorkOrderInput,
  CreateWorkOrderTaskBody,
  PutWorkOrderRootCauseBody,
  UpdateWorkOrderTaskBody,
  WorkOrderChecklistTemplatesResponse,
  WorkOrderTaskDto,
  UpdateWorkOrderStatusBody,
  WorkOrderCauseCodesResponse,
  WorkOrderDetail,
  WorkOrderListItem,
} from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type WorkOrdersListResponse = {
  items: WorkOrderListItem[];
};

/** `F4.284` (ADR 0030): the route's own `z.input`, from `@bms/shared` (`contracts/operations-writes.ts`). */
export type CreateWorkOrderInput = SharedCreateWorkOrderInput;

/** The path's `id` beside the route's own body (`updateWorkOrderStatusBodySchema`). */
export type UpdateWorkOrderStatusInput = { id: string } & UpdateWorkOrderStatusBody;

export type ReorderWorkOrderItem = {
  id: string;
  /** One of the five columns: a cancelled ticket is never sent (ADR 0122 decision 6.8). */
  status: BoardWorkOrderStatus;
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

/** GET /api/v1/work-orders/:id — the ticket with its timeline, checklist, findings and alarm snapshot (`E3.1`). */
export async function fetchWorkOrderDetail(id: string): Promise<WorkOrderDetail> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/work-orders/${id}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`work-order ${res.status}`);
  }
  return checkResponse(workOrderDetailSchema, await res.json(), "work-orders/:id");
}

/** GET /api/v1/work-orders/cause-codes — the active coded causes for the root-cause form (`E3.1`). */
export async function fetchWorkOrderCauseCodes(): Promise<WorkOrderCauseCodesResponse> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/work-orders/cause-codes`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`work-order-cause-codes ${res.status}`);
  }
  return checkResponse(workOrderCauseCodesResponseSchema, await res.json(), "work-orders/cause-codes");
}

/** One JSON write: the auth header, the body, the session cleared on a 401, the server's text as the error. */
async function sendJson(method: "POST" | "PATCH" | "PUT", path: string, body: unknown, label: string): Promise<unknown> {
  const sent = {
    ...withAuth({
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  };
  const res = await fetch(`${base}/api/v1/${path}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new Error(text || `${label} ${res.status}`);
  }
  return res.json();
}

/** GET /api/v1/work-orders/checklist-templates?assetId= — the active templates that fit the asset (`E3.1`, ruling P6). */
export async function fetchWorkOrderChecklistTemplates(assetId: string): Promise<WorkOrderChecklistTemplatesResponse> {
  const params = new URLSearchParams({ assetId });
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/work-orders/checklist-templates?${params}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`work-order-checklist-templates ${res.status}`);
  }
  return checkResponse(workOrderChecklistTemplatesResponseSchema, await res.json(), "work-orders/checklist-templates");
}

/** POST /api/v1/work-orders/:id/tasks — one checklist item added by hand (`E3.1`). */
export async function addWorkOrderTask(id: string, body: Pick<CreateWorkOrderTaskBody, "title"> & { mandatory?: boolean }): Promise<WorkOrderTaskDto> {
  return checkResponse(workOrderTaskDtoSchema, await sendJson("POST", `work-orders/${id}/tasks`, body, "work-order-task-add"), "work-orders/:id/tasks");
}

/** PATCH /api/v1/work-orders/:id/tasks/:taskId — an item's result, its note, or both (`E3.1`). */
export async function updateWorkOrderTask(id: string, taskId: string, body: UpdateWorkOrderTaskBody): Promise<WorkOrderTaskDto> {
  return checkResponse(
    workOrderTaskDtoSchema,
    await sendJson("PATCH", `work-orders/${id}/tasks/${taskId}`, body, "work-order-task-update"),
    "work-orders/:id/tasks/:taskId",
  );
}

/** PUT /api/v1/work-orders/:id/root-cause — the ticket's findings, replaced whole (`E3.1`). */
export async function putWorkOrderRootCause(id: string, body: PutWorkOrderRootCauseBody): Promise<WorkOrderDetail> {
  return checkResponse(workOrderDetailSchema, await sendJson("PUT", `work-orders/${id}/root-cause`, body, "work-order-root-cause"), "work-orders/:id/root-cause");
}

/** POST /api/v1/work-orders/:id/reject — an approver sends a resolved ticket back to work (`E3.1`). */
export async function rejectWorkOrder(id: string, reason: string): Promise<WorkOrderListItem> {
  return checkResponse(workOrderListItemSchema, await sendJson("POST", `work-orders/${id}/reject`, { reason }, "work-order-reject"), "work-orders/:id/reject");
}

/** POST /api/v1/work-orders/:id/cancel — an approver cancels a ticket; it cannot be undone (`E3.1`). */
export async function cancelWorkOrder(id: string, reason: string): Promise<WorkOrderListItem> {
  return checkResponse(workOrderListItemSchema, await sendJson("POST", `work-orders/${id}/cancel`, { reason }, "work-order-cancel"), "work-orders/:id/cancel");
}
