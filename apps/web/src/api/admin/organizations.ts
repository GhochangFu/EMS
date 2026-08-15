import {
  adminOrganizationDtoSchema,
  adminOrganizationSummaryDtoSchema,
  organizationsListResponseSchema,
} from "@bms/shared/contracts";
import type {
  AdminOrganizationDto,
  AdminOrganizationSummaryDto,
  MasterDataActiveFilter,
  OrganizationsListResponse,
} from "@bms/shared";

import { activeQuery, adminFetch } from "./client";

export type { OrganizationsListResponse };

export async function fetchAdminOrganizations(
  active: MasterDataActiveFilter = "all",
): Promise<OrganizationsListResponse> {
  return adminFetch(
    `/admin/organizations?${activeQuery(active)}`,
    organizationsListResponseSchema,
  );
}

export async function fetchAdminOrganizationSummary(
  id: string,
): Promise<AdminOrganizationSummaryDto> {
  return adminFetch(`/admin/organizations/${id}`, adminOrganizationSummaryDtoSchema);
}

export async function createAdminOrganization(input: {
  code: string;
  name: string;
}): Promise<AdminOrganizationDto> {
  return adminFetch("/admin/organizations", adminOrganizationDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAdminOrganization(
  id: string,
  input: { name: string },
): Promise<AdminOrganizationDto> {
  return adminFetch(`/admin/organizations/${id}`, adminOrganizationDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deactivateAdminOrganization(
  id: string,
): Promise<AdminOrganizationDto> {
  return adminFetch(`/admin/organizations/${id}/deactivate`, adminOrganizationDtoSchema, {
    method: "POST",
  });
}

export async function reactivateAdminOrganization(
  id: string,
): Promise<AdminOrganizationDto> {
  return adminFetch(`/admin/organizations/${id}/reactivate`, adminOrganizationDtoSchema, {
    method: "POST",
  });
}
