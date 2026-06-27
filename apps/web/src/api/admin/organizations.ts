import type { AdminOrganizationDto, AdminOrganizationSummaryDto, MasterDataActiveFilter } from "@bms/shared";

import { activeQuery, adminFetch } from "./client";

export type OrganizationsListResponse = { items: AdminOrganizationDto[] };

export async function fetchAdminOrganizations(
  active: MasterDataActiveFilter = "all",
): Promise<OrganizationsListResponse> {
  return adminFetch(`/admin/organizations?${activeQuery(active)}`);
}

export async function fetchAdminOrganizationSummary(
  id: string,
): Promise<AdminOrganizationSummaryDto> {
  return adminFetch(`/admin/organizations/${id}`);
}

export async function createAdminOrganization(input: {
  code: string;
  name: string;
}): Promise<AdminOrganizationDto> {
  return adminFetch("/admin/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAdminOrganization(
  id: string,
  input: { name: string },
): Promise<AdminOrganizationDto> {
  return adminFetch(`/admin/organizations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deactivateAdminOrganization(
  id: string,
): Promise<AdminOrganizationDto> {
  return adminFetch(`/admin/organizations/${id}/deactivate`, { method: "POST" });
}

export async function reactivateAdminOrganization(
  id: string,
): Promise<AdminOrganizationDto> {
  return adminFetch(`/admin/organizations/${id}/reactivate`, { method: "POST" });
}
