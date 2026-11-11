import { workOrderSlaPoliciesResponseSchema } from "@bms/shared/contracts";
import type { WorkOrderPriority, WorkOrderSlaPoliciesResponse } from "@bms/shared";

import { adminFetch } from "./client";

/**
 * `E3.1` (ADR 0122 decision 3.2, plan D8) — one organization's work-order SLA policy, at
 * `/admin/work-order-sla-policies`. Organization-level administrators only.
 *
 * The read always answers four rows, one per priority, each marked `organization` (the
 * organization's own row) or `default` (the platform default).
 */
export async function fetchWorkOrderSlaPolicies(organizationId: string): Promise<WorkOrderSlaPoliciesResponse> {
  const params = new URLSearchParams({ organizationId });
  return adminFetch(`/admin/work-order-sla-policies?${params}`, workOrderSlaPoliciesResponseSchema);
}

/** One row of the replace-all write. */
export type WorkOrderSlaPolicyInput = { priority: WorkOrderPriority; resolutionMinutes: number };

/** Replaces the organization's whole set: a priority left out goes back to the platform default. */
export async function putWorkOrderSlaPolicies(organizationId: string, policies: WorkOrderSlaPolicyInput[]): Promise<WorkOrderSlaPoliciesResponse> {
  return adminFetch("/admin/work-order-sla-policies", workOrderSlaPoliciesResponseSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId, policies }),
  });
}
