import {
  adminLocationTypeDtoSchema,
  adminLocationTypesListResponseSchema,
} from "@bms/shared/contracts";
import type { AdminLocationTypeDto, AdminLocationTypesListResponse } from "@bms/shared";

import { adminFetch } from "./client";

/**
 * `F4.162` (ADR 0077 Amendment 1, plan D7) — the global-admin catalog of
 * `bms.location_types`, at `/admin/vocabularies/location-types`.
 *
 * Not `fetchAdminLocationTypes` (`./locations`): that one reads
 * `GET /admin/location-types`, the active `{ code, label }` rows the locations
 * form offers. This module reads every row, retired ones included, with its
 * fleet-wide `locationCount`, and is refused to every role but `admin`.
 */
export async function fetchLocationTypeCatalog(): Promise<AdminLocationTypesListResponse> {
  return adminFetch("/admin/vocabularies/location-types", adminLocationTypesListResponseSchema);
}

export async function createLocationType(input: {
  code: string;
  label: string;
  sortOrder?: number;
}): Promise<AdminLocationTypeDto> {
  return adminFetch("/admin/vocabularies/location-types", adminLocationTypeDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** No `code`: it is the primary key, and the PATCH body is `.strict()` against it. */
export async function updateLocationType(
  code: string,
  input: { label?: string; sortOrder?: number },
): Promise<AdminLocationTypeDto> {
  return adminFetch(
    `/admin/vocabularies/location-types/${encodeURIComponent(code)}`,
    adminLocationTypeDtoSchema,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export async function deactivateLocationType(code: string): Promise<AdminLocationTypeDto> {
  return adminFetch(
    `/admin/vocabularies/location-types/${encodeURIComponent(code)}/deactivate`,
    adminLocationTypeDtoSchema,
    { method: "POST" },
  );
}

export async function reactivateLocationType(code: string): Promise<AdminLocationTypeDto> {
  return adminFetch(
    `/admin/vocabularies/location-types/${encodeURIComponent(code)}/reactivate`,
    adminLocationTypeDtoSchema,
    { method: "POST" },
  );
}
