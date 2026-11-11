import { workOrderChecklistTemplateDtoSchema, workOrderChecklistTemplatesResponseSchema } from "@bms/shared/contracts";
import type { WorkOrderChecklistTemplateDto, WorkOrderChecklistTemplatesResponse } from "@bms/shared";

import { adminFetch } from "./client";

/**
 * `E3.1` (ADR 0122 decision 4.2) — one organization's work-order checklist templates, at
 * `/admin/work-order-checklist-templates`. Organization-level administrators only.
 * A template's items are copied onto a ticket at create; a later edit never changes an
 * open ticket.
 */
export async function fetchAdminChecklistTemplates(organizationId: string): Promise<WorkOrderChecklistTemplatesResponse> {
  const params = new URLSearchParams({ organizationId });
  return adminFetch(`/admin/work-order-checklist-templates?${params}`, workOrderChecklistTemplatesResponseSchema);
}

/** One line of a template as it is written. The order of the array is the order of the checklist. */
export type ChecklistTemplateItemInput = { title: string; mandatory: boolean };

/** Adds an active template. `domain: null` fits every asset domain. */
export async function createChecklistTemplate(input: {
  organizationId: string;
  name: string;
  domain: string | null;
  items: ChecklistTemplateItemInput[];
}): Promise<WorkOrderChecklistTemplateDto> {
  return adminFetch("/admin/work-order-checklist-templates", workOrderChecklistTemplateDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Changes a template. `items`, when sent, replaces the whole list; `active: false` retires it. */
export async function updateChecklistTemplate(
  id: string,
  input: { name?: string; domain?: string | null; active?: boolean; items?: ChecklistTemplateItemInput[] },
): Promise<WorkOrderChecklistTemplateDto> {
  return adminFetch(`/admin/work-order-checklist-templates/${encodeURIComponent(id)}`, workOrderChecklistTemplateDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
