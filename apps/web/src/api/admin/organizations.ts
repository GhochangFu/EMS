import {
  adminOrganizationDtoSchema,
  adminOrganizationSummaryDtoSchema,
  organizationsListResponseSchema,
} from "@bms/shared/contracts";
import type {
  AdminOrganizationDto,
  ColourProfile,
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
  /** ISO 4217, upper-case; required — the API refuses a create without it (E4.1c). */
  currency: string;
  /** IANA zone or "UTC" (F3.85); the API defaults to UTC when absent. */
  timezone?: string;
}): Promise<AdminOrganizationDto> {
  return adminFetch("/admin/organizations", adminOrganizationDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAdminOrganization(
  id: string,
  input: { name: string; currency?: string; timezone?: string },
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

/**
 * `F4.310` (ADR 0110 decision 7) — `PUT /admin/organizations/:id/colour-profile`. The global admin
 * may set any organization; an organization admin only one it holds a direct grant on (else 403).
 */
export async function setOrganizationColourProfile(
  id: string,
  colourProfile: ColourProfile,
): Promise<AdminOrganizationDto> {
  return adminFetch(`/admin/organizations/${id}/colour-profile`, adminOrganizationDtoSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ colourProfile }),
  });
}
