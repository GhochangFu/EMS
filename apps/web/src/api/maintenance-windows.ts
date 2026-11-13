import {
  maintenanceWindowItemSchema,
  maintenanceWindowsResponseSchema,
  type CloseMaintenanceWindowBody,
  type CreateMaintenanceWindowBody,
  type ExtendMaintenanceWindowBody,
  type MaintenanceWindowItem,
  type MaintenanceWindowsResponse,
  type MaintenanceWindowState,
} from "@bms/shared/contracts";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F4.359` — the list query. Every key only narrows the caller's read scope
 * (`maintenance-windows.schema.ts`); a key left out is not sent.
 */
export type MaintenanceWindowsQuery = {
  readonly state?: MaintenanceWindowState;
  readonly assetId?: string;
  readonly locationId?: string;
  readonly organizationId?: string;
  readonly limit?: number;
};

/** `GET /api/v1/maintenance-windows`. */
export async function fetchMaintenanceWindows(
  query: MaintenanceWindowsQuery = {},
): Promise<MaintenanceWindowsResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/maintenance-windows?${params}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`maintenance-windows ${res.status}`);
  }
  return checkResponse(maintenanceWindowsResponseSchema, await res.json(), "maintenance-windows");
}

async function writeWindow(path: string, body: unknown, endpoint: string): Promise<MaintenanceWindowItem> {
  const sent = withAuth({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await fetch(`${base}/api/v1/maintenance-windows${path}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new Error(text || `${endpoint} ${res.status}`);
  }
  return checkResponse(maintenanceWindowItemSchema, await res.json(), endpoint);
}

/** `POST /api/v1/maintenance-windows`. */
export function createMaintenanceWindow(body: CreateMaintenanceWindowBody): Promise<MaintenanceWindowItem> {
  return writeWindow("", body, "maintenance-windows");
}

/** `POST /api/v1/maintenance-windows/:id/extend`. */
export function extendMaintenanceWindow(
  id: string,
  body: ExtendMaintenanceWindowBody,
): Promise<MaintenanceWindowItem> {
  return writeWindow(`/${id}/extend`, body, "maintenance-windows/:id/extend");
}

/** `POST /api/v1/maintenance-windows/:id/end` — an active window. */
export function endMaintenanceWindow(
  id: string,
  body: CloseMaintenanceWindowBody = {},
): Promise<MaintenanceWindowItem> {
  return writeWindow(`/${id}/end`, body, "maintenance-windows/:id/end");
}

/** `POST /api/v1/maintenance-windows/:id/cancel` — a future window. */
export function cancelMaintenanceWindow(
  id: string,
  body: CloseMaintenanceWindowBody = {},
): Promise<MaintenanceWindowItem> {
  return writeWindow(`/${id}/cancel`, body, "maintenance-windows/:id/cancel");
}
