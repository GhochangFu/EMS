import {
  convertMaintenanceResponseSchema,
  maintenanceScheduleItemSchema,
  maintenanceSchedulesResponseSchema,
} from "@bms/shared/contracts";
import type {
  CreateMaintenanceScheduleInput,
  MaintenanceScheduleItem,
  MaintenanceScheduleCategory,
  WorkOrderListItem,
  WorkOrderPriority,
} from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type MaintenanceSchedulesResponse = {
  items: MaintenanceScheduleItem[];
};

export type ConvertMaintenanceResponse = {
  workOrder: WorkOrderListItem;
};

/** `F4.281` (ADR 0030): the create body is the route's own, `@bms/shared`'s `createMaintenanceScheduleBodySchema`. */
export type { CreateMaintenanceScheduleInput };

/** GET /api/v1/maintenance/schedules */
export async function fetchMaintenanceSchedules(input: {
  assetId?: string;
  category?: MaintenanceScheduleCategory;
  dueState?: "all" | "overdue" | "upcoming";
  priority?: WorkOrderPriority | "all";
  horizonDays?: number;
  /** `F4.281` (owner ruling DC3): list deactivated schedules too. */
  includeInactive?: boolean;
}): Promise<MaintenanceSchedulesResponse> {
  const params = new URLSearchParams({
    horizonDays: String(input.horizonDays ?? 30),
  });
  if (input.assetId) {
    params.set("assetId", input.assetId);
  }
  if (input.category) {
    params.set("category", input.category);
  }
  if (input.dueState) {
    params.set("dueState", input.dueState);
  }
  if (input.priority) {
    params.set("priority", input.priority);
  }
  if (input.includeInactive) {
    params.set("includeInactive", "true");
  }
  const sent = withAuth();
  const res = await fetch(
    `${base}/api/v1/maintenance/schedules?${params}`,
    sent,
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`maintenance-schedules ${res.status}`);
  }
  return checkResponse(maintenanceSchedulesResponseSchema, await res.json(), "maintenance/schedules");
}

/** POST /api/v1/maintenance/schedules */
export async function createMaintenanceSchedule(
  input: CreateMaintenanceScheduleInput,
): Promise<MaintenanceScheduleItem> {
  const sent = {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  };
  const res = await fetch(`${base}/api/v1/maintenance/schedules`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new Error(text || `maintenance-create ${res.status}`);
  }
  return checkResponse(maintenanceScheduleItemSchema, await res.json(), "maintenance/schedules");
}

/** PATCH /api/v1/maintenance/schedules/:id */
export async function updateMaintenanceSchedule(input: {
  id: string;
  active: boolean;
  reason?: string;
}): Promise<MaintenanceScheduleItem> {
  const sent = {
    ...withAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: input.active, reason: input.reason }),
    }),
  };
  const res = await fetch(`${base}/api/v1/maintenance/schedules/${input.id}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new Error(text || `maintenance-update ${res.status}`);
  }
  return checkResponse(maintenanceScheduleItemSchema, await res.json(), "maintenance/schedules/:id");
}

/** POST /api/v1/maintenance/schedules/:id/convert */
export async function convertMaintenanceSchedule(input: {
  id: string;
  notes?: string;
}): Promise<ConvertMaintenanceResponse> {
  const sent = {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: input.notes }),
    }),
  };
  const res = await fetch(
    `${base}/api/v1/maintenance/schedules/${input.id}/convert`,
    sent,
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new Error(text || `maintenance-convert ${res.status}`);
  }
  return checkResponse(convertMaintenanceResponseSchema, await res.json(), "maintenance/schedules/:id/convert");
}
