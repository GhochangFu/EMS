import type {
  MaintenanceGenerationMode,
  MaintenanceScheduleItem,
  MaintenanceScheduleCategory,
  WorkOrderListItem,
  WorkOrderPriority,
} from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type MaintenanceSchedulesResponse = {
  items: MaintenanceScheduleItem[];
};

export type ConvertMaintenanceResponse = {
  workOrder: WorkOrderListItem;
};

export type CreateMaintenanceScheduleInput = {
  assetId: string;
  title: string;
  description?: string;
  category: MaintenanceScheduleCategory;
  generationMode: MaintenanceGenerationMode;
  ownerTeam?: string;
  vendorName?: string;
  complianceRef?: string;
  triggerSummary?: string;
  safetyCritical: boolean;
  priority: WorkOrderPriority;
  estimatedMinutes: number;
  intervalDays: number;
  firstDueAt: string;
};

/** GET /api/v1/maintenance/schedules */
export async function fetchMaintenanceSchedules(input: {
  assetId?: string;
  category?: MaintenanceScheduleCategory;
  dueState?: "all" | "overdue" | "upcoming";
  priority?: WorkOrderPriority | "all";
  horizonDays?: number;
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
  const res = await fetch(
    `${base}/api/v1/maintenance/schedules?${params}`,
    withAuth(),
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`maintenance-schedules ${res.status}`);
  }
  return res.json() as Promise<MaintenanceSchedulesResponse>;
}

/** POST /api/v1/maintenance/schedules */
export async function createMaintenanceSchedule(
  input: CreateMaintenanceScheduleInput,
): Promise<MaintenanceScheduleItem> {
  const res = await fetch(`${base}/api/v1/maintenance/schedules`, {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `maintenance-create ${res.status}`);
  }
  return res.json() as Promise<MaintenanceScheduleItem>;
}

/** PATCH /api/v1/maintenance/schedules/:id */
export async function updateMaintenanceSchedule(input: {
  id: string;
  active: boolean;
  reason?: string;
}): Promise<MaintenanceScheduleItem> {
  const res = await fetch(`${base}/api/v1/maintenance/schedules/${input.id}`, {
    ...withAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: input.active, reason: input.reason }),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `maintenance-update ${res.status}`);
  }
  return res.json() as Promise<MaintenanceScheduleItem>;
}

/** POST /api/v1/maintenance/schedules/:id/convert */
export async function convertMaintenanceSchedule(input: {
  id: string;
  notes?: string;
}): Promise<ConvertMaintenanceResponse> {
  const res = await fetch(
    `${base}/api/v1/maintenance/schedules/${input.id}/convert`,
    {
      ...withAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: input.notes }),
      }),
    },
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `maintenance-convert ${res.status}`);
  }
  return res.json() as Promise<ConvertMaintenanceResponse>;
}
